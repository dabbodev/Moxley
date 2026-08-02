'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fsp = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { after, before, describe, it } = require('node:test');

const buildModule = require('../scripts/build-windows-native.cjs');
const cleanModule = require('../scripts/clean-windows-native.cjs');
const { internal } = buildModule;
const buildTest = buildModule.__test;

const REPOSITORY_ROOT = path.resolve(__dirname, '..');
const BUILD_SCRIPT = path.join(
  REPOSITORY_ROOT,
  'scripts',
  'build-windows-native.cjs',
);
const CLEAN_SCRIPT = path.join(
  REPOSITORY_ROOT,
  'scripts',
  'clean-windows-native.cjs',
);
const SOURCE = path.join(
  REPOSITORY_ROOT,
  'native',
  'windows-reparse-classifier.c',
);
const OLD_SOURCE = path.join(
  REPOSITORY_ROOT,
  'test',
  'native',
  'windows-reparse-classifier.c',
);
const RELEASE = path.join(REPOSITORY_ROOT, 'build', 'Release');
const ARTIFACT = path.join(
  RELEASE,
  'moxley-windows-reparse.node',
);
const RECEIPT = path.join(
  RELEASE,
  'moxley-windows-reparse.receipt.json',
);
const LOCK = path.join(
  RELEASE,
  '.moxley-windows-reparse-build.lock',
);
const STAGING_PREFIX = '.moxley-windows-reparse-stage-';
const HARNESS_PROCESS_TIMEOUT_MS = 300_000;
const POWERSHELL_EXE = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
const SUBPROCESS_CODES = Object.freeze({
  spawn: 'MOXLEY_NATIVE_BUILD_SUBPROCESS_SPAWN_FAILED',
  timeout: 'MOXLEY_NATIVE_BUILD_SUBPROCESS_TIMED_OUT',
  output: 'MOXLEY_NATIVE_BUILD_SUBPROCESS_OUTPUT_LIMIT',
  exit: 'MOXLEY_NATIVE_BUILD_SUBPROCESS_EXIT_FAILED',
  termination:
    'MOXLEY_NATIVE_BUILD_SUBPROCESS_TERMINATION_UNCONFIRMED',
});
const SUBPROCESS_REASONS = Object.freeze([
  'SUBPROCESS_SPAWN_ERROR',
  'SUBPROCESS_TIMEOUT',
  'SUBPROCESS_STDOUT_LIMIT',
  'SUBPROCESS_STDERR_LIMIT',
  'SUBPROCESS_NONZERO_EXIT',
  'SUBPROCESS_SIGNALLED_EXIT',
  'SUBPROCESS_EXIT_WITHOUT_CLOSE',
  'SUBPROCESS_TERMINATION_TOOL_FAILED',
  'SUBPROCESS_TERMINATION_NOT_CONFIRMED',
]);
const INVENTORY_PROCESS_SOURCE = String.raw`
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$OutputEncoding=[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$requestText=[Console]::In.ReadToEnd()
if ($requestText.Length -le 0 -or $requestText.Length -gt 4096) {
  throw 'PROCESS_REQUEST_INVALID'
}
try {
  $request=ConvertFrom-Json $requestText
} catch {
  throw 'PROCESS_REQUEST_INVALID'
}
if (
  ($request.PSObject.Properties.Name -join ',') -ne
    'rootPid,buildScript,cleanScript,release' -or
  ($request.rootPid -isnot [long] -and $request.rootPid -isnot [int]) -or
  $request.rootPid -le 0 -or
  $request.rootPid -gt [int]::MaxValue
) {
  throw 'PROCESS_REQUEST_INVALID'
}
foreach ($expectedPath in @(
  $request.buildScript,
  $request.cleanScript,
  $request.release
)) {
  if (
    $expectedPath -isnot [string] -or
    $expectedPath.Length -le 0 -or
    $expectedPath.Length -gt 1024 -or
    ![IO.Path]::IsPathFullyQualified($expectedPath)
  ) {
    throw 'PROCESS_REQUEST_INVALID'
  }
}
$testRootPid=[int64]$request.rootPid
if ($testRootPid -gt [int]::MaxValue -or $testRootPid -eq $PID) {
  throw 'PROCESS_ROOT_INVALID'
}
$snapshot=@(Get-CimInstance -ClassName Win32_Process)
if ($snapshot.Count -gt 8192) { throw 'PROCESS_SNAPSHOT_LIMIT' }
$byPid=@{}
foreach ($entry in $snapshot) {
  $entryPid=[int64]$entry.ProcessId
  $parentPid=[int64]$entry.ParentProcessId
  if (
    $entryPid -lt 0 -or
    $entryPid -gt [int]::MaxValue -or
    $parentPid -lt 0 -or
    $parentPid -gt [int]::MaxValue -or
    $byPid.ContainsKey([int]$entryPid)
  ) {
    throw 'PROCESS_SNAPSHOT_INVALID'
  }
  $byPid.Add([int]$entryPid,$entry)
}
if (!$byPid.ContainsKey([int]$testRootPid)) { throw 'PROCESS_ROOT_INVALID' }
if ([string]$byPid[[int]$testRootPid].Name -ne 'node.exe') {
  throw 'PROCESS_ROOT_INVALID'
}
function Get-CreationTicks($entry) {
  if ($null -eq $entry.CreationDate) { return $null }
  try {
    return ([datetime]$entry.CreationDate).ToUniversalTime().Ticks
  } catch {
    return $null
  }
}
$testRootCreationTicks=Get-CreationTicks $byPid[[int]$testRootPid]
if ($null -eq $testRootCreationTicks) { throw 'PROCESS_ROOT_INVALID' }
function Get-TaskAncestry($candidate) {
  $seen=[System.Collections.Generic.HashSet[int]]::new()
  $current=$candidate
  $currentTicks=Get-CreationTicks $current
  if ($null -eq $currentTicks) { return 'ambiguous' }
  if ($currentTicks -lt $testRootCreationTicks) { return 'other' }
  for ($depth=0; $depth -lt 64; $depth++) {
    $currentPid=[int]$current.ProcessId
    if (!$seen.Add($currentPid)) { return 'ambiguous' }
    $parentPid=[int]$current.ParentProcessId
    if ($parentPid -le 0) { return 'other' }
    if (!$byPid.ContainsKey($parentPid)) { return 'ambiguous' }
    $parent=$byPid[$parentPid]
    $parentTicks=Get-CreationTicks $parent
    if ($null -eq $parentTicks -or $parentTicks -gt $currentTicks) {
      return 'ambiguous'
    }
    if ($parentPid -eq [int]$PID) {
      if ($parentTicks -ne $inventoryCreationTicks) { return 'ambiguous' }
      return 'census-rooted'
    }
    if ($parentPid -eq [int]$testRootPid) {
      if ($parentTicks -ne $testRootCreationTicks) { return 'ambiguous' }
      return 'task-rooted'
    }
    if ($parentTicks -lt $testRootCreationTicks) { return 'other' }
    $current=$parent
    $currentTicks=$parentTicks
  }
  return 'ambiguous'
}
function Test-ContainsOrdinalIgnoreCase([string]$text,[string]$value) {
  return $text.IndexOf($value,[StringComparison]::OrdinalIgnoreCase) -ge 0
}
function Get-TaskRole($entry) {
  $name=[string]$entry.Name
  $command=[string]$entry.CommandLine
  if ($name -eq 'node.exe') {
    if (Test-ContainsOrdinalIgnoreCase $command $request.buildScript) {
      return 'native-build-node'
    }
    if (Test-ContainsOrdinalIgnoreCase $command $request.cleanScript) {
      return 'native-clean-node'
    }
    if (Test-ContainsOrdinalIgnoreCase $command 'moxley-native-build-probe') {
      return 'native-probe-node'
    }
    return $null
  }
  if ($name -eq 'cl.exe') {
    if (
      (Test-ContainsOrdinalIgnoreCase $command $request.release) -and
      (Test-ContainsOrdinalIgnoreCase $command 'moxley-windows-reparse-compile.rsp')
    ) {
      return 'native-compiler'
    }
    return $null
  }
  if ($name -eq 'link.exe') {
    if (
      (Test-ContainsOrdinalIgnoreCase $command $request.release) -and
      (Test-ContainsOrdinalIgnoreCase $command 'moxley-windows-reparse-link.rsp')
    ) {
      return 'native-linker'
    }
    return $null
  }
  if ($name -eq 'pwsh.exe') {
    if ($command -match '^"?C:\\Program Files\\PowerShell\\7\\pwsh\.exe"?\s+-NoLogo\s+-NoProfile\s+-NonInteractive\s+-ExecutionPolicy\s+Bypass\s+-EncodedCommand\s+[A-Za-z0-9+/=]+\s*$') {
      return 'bounded-powershell'
    }
    return $null
  }
  if ($name -eq 'taskkill.exe') {
    if ($command -match '^"?C:\\Windows\\System32\\taskkill\.exe"?\s+/PID\s+[1-9][0-9]*\s+/T\s+/F\s*$') {
      return 'taskkill-tree'
    }
    return $null
  }
  if ($name -eq 'fsutil.exe') {
    if ($command -match '^"?C:\\Windows\\System32\\fsutil\.exe"?\s+reparsepoint\s+query\s+.+$') {
      return 'filesystem-authentication'
    }
    return $null
  }
  if ($name -eq 'vswhere.exe') {
    if (
      $command -match '^"?C:\\Program Files \(x86\)\\Microsoft Visual Studio\\Installer\\vswhere\.exe"?\s+-products\s+Microsoft\.VisualStudio\.Product\.BuildTools\s+-property\s+installationVersion\s*$'
    ) {
      return 'visual-studio-authentication'
    }
    return $null
  }
  return $null
}
function Test-ExplicitMoxleyRole([string]$role) {
  return $role -in @(
    'native-build-node',
    'native-clean-node',
    'native-probe-node',
    'native-compiler',
    'native-linker'
  )
}
$inventoryEntry=$byPid[[int]$PID]
$inventoryCreationTicks=Get-CreationTicks $inventoryEntry
if (
  $null -eq $inventoryEntry -or
  [string]$inventoryEntry.Name -ne 'pwsh.exe' -or
  [int]$inventoryEntry.ParentProcessId -ne [int]$testRootPid -or
  $null -eq $inventoryCreationTicks -or
  $inventoryCreationTicks -lt $testRootCreationTicks -or
  (Get-TaskRole $inventoryEntry) -ne 'bounded-powershell'
) {
  throw 'PROCESS_CENSUS_IDENTITY_INVALID'
}
$items=[System.Collections.Generic.List[object]]::new()
foreach ($entry in $snapshot) {
  if ($entry.ProcessId -eq $PID -or $entry.ProcessId -eq $testRootPid) {
    continue
  }
  $ancestry=Get-TaskAncestry $entry
  if ($ancestry -eq 'census-rooted') { continue }
  $role=Get-TaskRole $entry
  $boundedName=[string]$entry.Name
  if ($ancestry -eq 'task-rooted' -and $null -eq $role) {
    $role='other-task-descendant'
    $boundedName='task-descendant'
  } elseif ($null -eq $role) {
    continue
  }
  $explicit=Test-ExplicitMoxleyRole $role
  if ($ancestry -eq 'other' -and !$explicit) { continue }
  $classification=if ($ancestry -eq 'task-rooted') {
    'task-rooted'
  } elseif ($explicit) {
    'moxley-command'
  } else {
    'ambiguous'
  }
  $creationTicks=Get-CreationTicks $entry
  if ($null -eq $creationTicks) { throw 'PROCESS_CREATION_INVALID' }
  [void]$items.Add([pscustomobject][ordered]@{
    name=$boundedName
    role=$role
    processId=[int]$entry.ProcessId
    parentProcessId=[int]$entry.ParentProcessId
    creationToken=$creationTicks.ToString([Globalization.CultureInfo]::InvariantCulture)
    classification=$classification
  })
}
$items=@($items | Sort-Object processId)
if ($items.Count -gt 128) { throw 'PROCESS_INVENTORY_LIMIT' }
[Console]::Out.Write((ConvertTo-Json -Compress -InputObject @($items)))
`;
const sandboxRoots = new Set();
let repositoryBuildOwned = false;
let liveServer = null;
let liveLockOwned = false;
let ambiguousProcessBaseline = new Set();
let uncertainRepositoryState = false;
let lastUncertainInventory = null;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function exists(target) {
  try {
    await fsp.lstat(target);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

function encodedPowerShell(command) {
  return Buffer.from(command, 'utf16le').toString('base64');
}

function processEvidenceKey(processEvidence) {
  return [
    processEvidence.name,
    processEvidence.processId,
    processEvidence.creationToken,
  ].join(':');
}

async function captureCandidateProcesses() {
  let result;
  try {
    result = await buildTest.runProcess(
      POWERSHELL_EXE,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        encodedPowerShell(INVENTORY_PROCESS_SOURCE),
      ],
      {
        env: process.env,
        stdin: Buffer.from(JSON.stringify({
          rootPid: process.pid,
          buildScript: BUILD_SCRIPT,
          cleanScript: CLEAN_SCRIPT,
          release: RELEASE,
        }), 'utf8'),
        timeoutMs: HARNESS_PROCESS_TIMEOUT_MS,
      },
    );
  } catch (error) {
    if (
      error?.code === SUBPROCESS_CODES.timeout ||
      error?.code === SUBPROCESS_CODES.termination
    ) {
      uncertainRepositoryState = true;
    }
    return { confirmed: false, processes: [] };
  }
  if (
    result.code !== 0 ||
    result.signal !== null ||
    result.stderr.length !== 0 ||
    result.stdout.length === 0 ||
    result.stdout.length > 64 * 1024
  ) {
    return { confirmed: false, processes: [] };
  }
  let value;
  try {
    value = JSON.parse(result.stdout.toString('utf8'));
  } catch {
    return { confirmed: false, processes: [] };
  }
  if (!Array.isArray(value) || value.length > 128) {
    return { confirmed: false, processes: [] };
  }
  const acceptedNames = new Set([
    'cl.exe',
    'fsutil.exe',
    'link.exe',
    'node.exe',
    'pwsh.exe',
    'task-descendant',
    'taskkill.exe',
    'vswhere.exe',
  ]);
  const processes = [];
  for (const entry of value) {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      JSON.stringify(Object.keys(entry)) !==
        JSON.stringify([
          'name',
          'role',
          'processId',
          'parentProcessId',
          'creationToken',
          'classification',
        ]) ||
      !acceptedNames.has(entry.name) ||
      ![
        'bounded-powershell',
        'filesystem-authentication',
        'native-build-node',
        'native-clean-node',
        'native-compiler',
        'native-linker',
        'native-probe-node',
        'other-task-descendant',
        'taskkill-tree',
        'visual-studio-authentication',
      ].includes(entry.role) ||
      !Number.isSafeInteger(entry.processId) ||
      entry.processId <= 0 ||
      !Number.isSafeInteger(entry.parentProcessId) ||
      entry.parentProcessId < 0 ||
      typeof entry.creationToken !== 'string' ||
      !/^[1-9][0-9]{0,18}$/.test(entry.creationToken) ||
      ![
        'ambiguous',
        'moxley-command',
        'task-rooted',
      ].includes(entry.classification)
    ) {
      return { confirmed: false, processes: [] };
    }
    processes.push(Object.freeze({
      name: entry.name,
      role: entry.role,
      processId: entry.processId,
      parentProcessId: entry.parentProcessId,
      creationToken: entry.creationToken,
      classification: entry.classification,
    }));
  }
  return { confirmed: true, processes };
}

async function entryKind(target) {
  try {
    const metadata = await fsp.lstat(target);
    if (metadata.isSymbolicLink()) return 'symbolic-link';
    if (metadata.isFile()) return 'file';
    if (metadata.isDirectory()) return 'directory';
    return 'other';
  } catch (error) {
    if (error && error.code === 'ENOENT') return 'absent';
    return 'unknown';
  }
}

function inventoryPipe(pipeName) {
  return new Promise((resolve) => {
    let settled = false;
    let socket;
    let timer;
    function finish(status) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (socket !== undefined) {
        socket.removeAllListeners();
        socket.destroy();
      }
      resolve(status);
    }
    try {
      socket = net.connect(pipeName);
    } catch {
      finish('unknown');
      return;
    }
    timer = setTimeout(() => finish('unknown'), 1_000);
    socket.once('connect', () => finish('active'));
    socket.once('error', (error) => {
      finish(error && error.code === 'ENOENT' ? 'absent' : 'unknown');
    });
  });
}

async function inventoryRepositoryState() {
  let identity;
  try {
    identity = await buildTest.repositoryLeaseIdentity();
  } catch {
    return Object.freeze({
      filesystemEvidenceConfirmed: false,
      artifact: 'unknown',
      receipt: 'unknown',
      lock: 'unknown',
      stagingCount: 0,
      releaseEntryCount: 0,
      pipe: 'unknown',
      processEvidenceConfirmed: false,
      taskOwnedProcessCount: 0,
      taskOwnedProcessNames: Object.freeze([]),
    });
  }
  const artifact = await entryKind(identity.paths.artifact);
  const receipt = await entryKind(identity.paths.receipt);
  const lock = await entryKind(identity.paths.lock);
  let releaseEntryCount = 0;
  let stagingCount = 0;
  let releaseRead = true;
  try {
    const entries = await fsp.readdir(identity.paths.release);
    releaseEntryCount = entries.length;
    stagingCount = entries.filter((name) =>
      name.startsWith(STAGING_PREFIX)).length;
  } catch (error) {
    if (!(error && error.code === 'ENOENT')) releaseRead = false;
  }
  const pipe = await inventoryPipe(identity.pipeName);
  const processEvidence = await captureCandidateProcesses();
  const taskOwnedProcesses = processEvidence.processes.filter(
    (entry) => !ambiguousProcessBaseline.has(processEvidenceKey(entry)),
  );
  const taskOwnedProcessNames = [...new Set(
    taskOwnedProcesses.map((entry) => entry.role),
  )].sort();
  return Object.freeze({
    filesystemEvidenceConfirmed:
      releaseRead && ![artifact, receipt, lock].includes('unknown'),
    artifact,
    receipt,
    lock,
    stagingCount,
    releaseEntryCount,
    pipe,
    processEvidenceConfirmed: processEvidence.confirmed,
    taskOwnedProcessCount: taskOwnedProcesses.length,
    taskOwnedProcessNames: Object.freeze(taskOwnedProcessNames),
  });
}

async function inventoryPromotionScenario(result) {
  const repository = await inventoryRepositoryState();
  return Object.freeze({
    artifact: await entryKind(result.paths.artifact),
    receipt: await entryKind(result.paths.receipt),
    lock: await entryKind(result.paths.lock),
    staging: await entryKind(result.paths.staging),
    pipe: repository.pipe,
    processEvidenceConfirmed: repository.processEvidenceConfirmed,
    taskOwnedProcessCount: repository.taskOwnedProcessCount,
    taskOwnedProcessNames: repository.taskOwnedProcessNames,
  });
}

function inventorySupportsCleanup(inventory) {
  return (
    inventory.filesystemEvidenceConfirmed === true &&
    inventory.pipe === 'absent' &&
    inventory.processEvidenceConfirmed === true &&
    inventory.taskOwnedProcessCount === 0
  );
}

async function recordUncertainProcessDisposition(disposition) {
  const inventory = await inventoryRepositoryState();
  lastUncertainInventory = inventory;
  if (
    disposition.disposition === SUBPROCESS_CODES.timeout ||
    disposition.disposition === SUBPROCESS_CODES.termination ||
    disposition.terminationConfirmed !== true ||
    !inventorySupportsCleanup(inventory)
  ) {
    uncertainRepositoryState = true;
  }
}

function boundedSupervisorFailure(error) {
  const code = Object.values(SUBPROCESS_CODES).includes(error?.code)
    ? error.code
    : SUBPROCESS_CODES.termination;
  const reason = SUBPROCESS_REASONS.includes(error?.reason)
    ? error.reason
    : 'SUBPROCESS_TERMINATION_NOT_CONFIRMED';
  const causeReason = SUBPROCESS_REASONS.includes(error?.cause?.reason)
    ? error.cause.reason
    : null;
  return {
    ok: false,
    disposition: code,
    reason,
    causeReason,
    terminationConfirmed: error?.terminationConfirmed === true,
    code: null,
    signal: null,
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
  };
}

function boundedCompletedProcess(result) {
  if (result.code === 0 && result.signal === null) {
    return {
      ...result,
      ok: true,
      disposition: 'SUBPROCESS_SUCCEEDED',
      reason: null,
      causeReason: null,
      terminationConfirmed: true,
    };
  }
  if (typeof result.signal === 'string' && result.signal.length !== 0) {
    return {
      ...result,
      ok: false,
      disposition: SUBPROCESS_CODES.exit,
      reason: 'SUBPROCESS_SIGNALLED_EXIT',
      causeReason: null,
      terminationConfirmed: true,
    };
  }
  if (Number.isInteger(result.code) && result.code !== 0) {
    return {
      ...result,
      ok: false,
      disposition: SUBPROCESS_CODES.exit,
      reason: 'SUBPROCESS_NONZERO_EXIT',
      causeReason: null,
      terminationConfirmed: true,
    };
  }
  return {
    ok: false,
    disposition: SUBPROCESS_CODES.termination,
    reason: 'SUBPROCESS_TERMINATION_NOT_CONFIRMED',
    causeReason: null,
    terminationConfirmed: false,
    code: result.code ?? null,
    signal: result.signal ?? null,
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
  };
}

async function runProcess(file, arguments_, options = {}) {
  let disposition;
  try {
    const result = await buildTest.runProcess(file, arguments_, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdin: options.stdin,
      timeoutMs: HARNESS_PROCESS_TIMEOUT_MS,
    });
    disposition = boundedCompletedProcess(result);
  } catch (error) {
    disposition = boundedSupervisorFailure(error);
  }
  if (
    disposition.disposition === SUBPROCESS_CODES.timeout ||
    disposition.disposition === SUBPROCESS_CODES.termination
  ) {
    await recordUncertainProcessDisposition(disposition);
  }
  return disposition;
}

function runNodeScript(script, extraArguments = []) {
  return runProcess(process.execPath, [script, ...extraArguments], {
    cwd: os.tmpdir(),
  });
}

function parseCanonicalOutput(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  assert.equal(text.endsWith('\n'), true);
  assert.equal(text.includes('\r'), false);
  assert.equal(text.indexOf('\n'), text.length - 1);
  const value = JSON.parse(text.slice(0, -1));
  assert.equal(`${JSON.stringify(value)}\n`, text);
  return value;
}

function assertBoundedFailure(result) {
  assert.equal(result.ok, false);
  assert.equal(result.disposition, SUBPROCESS_CODES.exit);
  assert.equal(result.reason, 'SUBPROCESS_NONZERO_EXIT');
  assert.equal(result.terminationConfirmed, true);
  assert.notEqual(result.code, 0);
  assert.equal(result.signal, null);
  assert.equal(result.stdout.length, 0);
  const stderr = result.stderr.toString('utf8');
  assert.equal(stderr.endsWith('\n'), true);
  assert.equal(stderr.includes('\r'), false);
  assert.equal(stderr.indexOf('\n'), stderr.length - 1);
  assert.equal(stderr.length <= 241, true);
  assert.doesNotMatch(stderr, /[A-Za-z]:\\/);
}

function assertBoundedSuccess(result) {
  assert.equal(result.ok, true);
  assert.equal(result.disposition, 'SUBPROCESS_SUCCEEDED');
  assert.equal(result.reason, null);
  assert.equal(result.causeReason, null);
  assert.equal(result.terminationConfirmed, true);
  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
}

function assertHarnessDispositionMatrix() {
  const errorCases = [
    {
      code: SUBPROCESS_CODES.spawn,
      reason: 'SUBPROCESS_SPAWN_ERROR',
      terminationConfirmed: false,
    },
    {
      code: SUBPROCESS_CODES.timeout,
      reason: 'SUBPROCESS_TIMEOUT',
      terminationConfirmed: true,
    },
    {
      code: SUBPROCESS_CODES.output,
      reason: 'SUBPROCESS_STDOUT_LIMIT',
      terminationConfirmed: true,
    },
    {
      code: SUBPROCESS_CODES.output,
      reason: 'SUBPROCESS_STDERR_LIMIT',
      terminationConfirmed: true,
    },
    {
      code: SUBPROCESS_CODES.termination,
      reason: 'SUBPROCESS_TERMINATION_NOT_CONFIRMED',
      terminationConfirmed: false,
      cause: Object.freeze({ reason: 'SUBPROCESS_EXIT_WITHOUT_CLOSE' }),
    },
    {
      code: SUBPROCESS_CODES.termination,
      reason: 'SUBPROCESS_TERMINATION_TOOL_FAILED',
      terminationConfirmed: false,
      cause: Object.freeze({ reason: 'SUBPROCESS_STDOUT_LIMIT' }),
    },
  ];
  for (const expected of errorCases) {
    const actual = boundedSupervisorFailure(Object.freeze(expected));
    assert.equal(actual.ok, false);
    assert.equal(actual.disposition, expected.code);
    assert.equal(actual.reason, expected.reason);
    assert.equal(
      actual.causeReason,
      expected.cause?.reason ?? null,
    );
    assert.equal(
      actual.terminationConfirmed,
      expected.terminationConfirmed,
    );
    assert.equal(actual.code, null);
    assert.equal(typeof actual.disposition, 'string');
    assert.equal(typeof actual.reason, 'string');
  }

  const completedCases = [
    {
      result: {
        code: 23,
        signal: null,
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
      },
      reason: 'SUBPROCESS_NONZERO_EXIT',
    },
    {
      result: {
        code: null,
        signal: 'SIGTERM',
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
      },
      reason: 'SUBPROCESS_SIGNALLED_EXIT',
    },
  ];
  for (const expected of completedCases) {
    const actual = boundedCompletedProcess(expected.result);
    assert.equal(actual.ok, false);
    assert.equal(actual.disposition, SUBPROCESS_CODES.exit);
    assert.equal(actual.reason, expected.reason);
    assert.equal(actual.terminationConfirmed, true);
    assert.equal(typeof actual.disposition, 'string');
    assert.equal(typeof actual.reason, 'string');
  }

  const unexplainedNull = boundedCompletedProcess({
    code: null,
    signal: null,
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
  });
  assert.equal(unexplainedNull.ok, false);
  assert.equal(unexplainedNull.disposition, SUBPROCESS_CODES.termination);
  assert.equal(
    unexplainedNull.reason,
    'SUBPROCESS_TERMINATION_NOT_CONFIRMED',
  );
}

async function releaseEntries() {
  if (!(await exists(RELEASE))) return [];
  return (await fsp.readdir(RELEASE)).sort(internal.ordinalCompare);
}

async function assertRepositoryGeneratedStateAbsent() {
  for (const target of [ARTIFACT, RECEIPT, LOCK]) {
    assert.equal(await exists(target), false, `${target} must be absent`);
  }
  const entries = await releaseEntries();
  assert.deepEqual(
    entries.filter((name) => name.startsWith(STAGING_PREFIX)),
    [],
  );
  assert.deepEqual(
    entries.filter((name) =>
      /\.(?:node|obj|lib|exp|pdb|rsp)$/i.test(name),
    ),
    [],
  );
}

async function createSandbox() {
  const root = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'moxley-native-build-test-'),
  );
  sandboxRoots.add(root);
  return root;
}

async function removeSandbox(root) {
  const tempRoot = await fsp.realpath(os.tmpdir());
  const resolved = path.resolve(root);
  assert.equal(path.dirname(resolved).toLowerCase(), tempRoot.toLowerCase());
  assert.equal(
    path.basename(resolved).startsWith('moxley-native-build-test-'),
    true,
  );
  await fsp.rm(resolved, { recursive: true, force: false });
  sandboxRoots.delete(root);
}

async function startServer(pipeName) {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => socket.destroy());
    server.once('error', reject);
    server.listen(pipeName, () => resolve(server));
  });
}

async function closeServer(server) {
  if (server === null) return;
  await new Promise((resolve) => server.close(resolve));
}

async function gitTrackedCFiles() {
  const result = await runProcess(
    'git.exe',
    ['ls-files', '--cached', '--others', '--exclude-standard', '*.c'],
    { cwd: REPOSITORY_ROOT },
  );
  assertBoundedSuccess(result);
  assert.equal(result.stderr.length, 0);
  const candidates = result.stdout
    .toString('utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  const existing = [];
  for (const candidate of candidates) {
    if (await exists(path.join(REPOSITORY_ROOT, candidate))) {
      existing.push(candidate);
    }
  }
  return existing.sort(internal.ordinalCompare);
}

async function independentHeaderLedger() {
  const headerRoot = path.join(
    process.env.LOCALAPPDATA,
    'node-gyp',
    'Cache',
    '24.13.0',
    'include',
    'node',
  );
  const names = [
    'node_api.h',
    'node_api_types.h',
    'js_native_api.h',
    'js_native_api_types.h',
    'node_version.h',
  ].sort(internal.ordinalCompare);
  const rows = [];
  for (const name of names) {
    const bytes = await fsp.readFile(path.join(headerRoot, name));
    rows.push(
      Buffer.concat([
        Buffer.from(name),
        Buffer.from([0]),
        Buffer.from(String(bytes.length)),
        Buffer.from([0]),
        Buffer.from(sha256(bytes)),
        Buffer.from('\n'),
      ]),
    );
  }
  return sha256(Buffer.concat(rows));
}

describe(
  'explicit Windows native build and clean lifecycle',
  { concurrency: false },
  () => {
    before(async () => {
      await assertRepositoryGeneratedStateAbsent();
      const baseline = await captureCandidateProcesses();
      assert.equal(
        baseline.confirmed,
        true,
        'bounded task-owned process baseline must be available',
      );
      assert.equal(
        baseline.processes.every(
          (entry) => entry.classification === 'ambiguous',
        ),
        true,
        'preexisting Moxley or task-rooted processes are not baselineable',
      );
      ambiguousProcessBaseline = new Set(
        baseline.processes.map(processEvidenceKey),
      );
    });

    after(async () => {
      if (liveServer !== null) {
        await closeServer(liveServer);
        liveServer = null;
      }
      if (uncertainRepositoryState) {
        lastUncertainInventory = await inventoryRepositoryState();
        assert.equal(lastUncertainInventory.filesystemEvidenceConfirmed, true);
        assert.fail(
          'Uncertain native subprocess state was inventoried and preserved.',
        );
      }
      if (liveLockOwned && (await exists(LOCK))) {
        await fsp.unlink(LOCK);
        liveLockOwned = false;
      }
      if (repositoryBuildOwned) {
        const cleanup = await runNodeScript(CLEAN_SCRIPT);
        assertBoundedSuccess(cleanup);
        assert.equal(cleanup.stderr.length, 0);
        repositoryBuildOwned = false;
      }
      for (const root of [...sandboxRoots]) await removeSandbox(root);
      await assertRepositoryGeneratedStateAbsent();
      const finalInventory = await inventoryRepositoryState();
      assert.equal(finalInventory.filesystemEvidenceConfirmed, true);
      assert.equal(finalInventory.artifact, 'absent');
      assert.equal(finalInventory.receipt, 'absent');
      assert.equal(finalInventory.lock, 'absent');
      assert.equal(finalInventory.stagingCount, 0);
      assert.equal(finalInventory.pipe, 'absent');
      assert.equal(finalInventory.processEvidenceConfirmed, true);
      assert.equal(finalInventory.taskOwnedProcessCount, 0);
    });

    it(
      'production native source is the single characterized classifier authority',
      async () => {
        assert.equal(HARNESS_PROCESS_TIMEOUT_MS, 300_000);
        assert.equal(buildTest.PROCESS_TIMEOUT_MS, 30_000);
        assert.equal(buildTest.AUTHENTICATION_TIMEOUT_MS, 90_000);
        assert.equal(buildTest.PROBE_TIMEOUT_MS, 10_000);
        assert.equal(buildTest.EXIT_CLOSE_GRACE_MS, 5_000);
        assert.equal(buildTest.TASKKILL_TIMEOUT_MS, 10_000);
        assert.equal(buildTest.POST_TERMINATION_GRACE_MS, 5_000);
        assert.equal(buildTest.MAX_PROCESS_OUTPUT_BYTES, 2 * 1024 * 1024);
        assertHarnessDispositionMatrix();
        assert.deepEqual(await gitTrackedCFiles(), [
          'native/windows-reparse-classifier.c',
        ]);
        assert.equal(await exists(OLD_SOURCE), false);
        const source = await fsp.readFile(SOURCE, 'utf8');
        assert.match(
          source,
          /^\/\/ SPDX-License-Identifier: Apache-2\.0$/m,
        );
        assert.match(source, /Private production Node-API source/);
        assert.match(source, /^#define NAPI_VERSION 8$/m);
        assert.match(
          source,
          /Characterization-only fault injection[\s\S]*#ifdef MOXLEY_TEST_FORCE_ATTRIBUTE_QUERY_FAILURE/,
        );
        const characterization = await fsp.readFile(
          path.join(__dirname, 'windows-reparse-native.test.cjs'),
          'utf8',
        );
        assert.match(
          characterization,
          /REPOSITORY_ROOT,[\s\S]*'native',[\s\S]*'windows-reparse-classifier\.c'/,
        );
        const buildSource = await fsp.readFile(BUILD_SCRIPT, 'utf8');
        assert.doesNotMatch(
          buildSource,
          /\/DMOXLEY_TEST_FORCE_ATTRIBUTE_QUERY_FAILURE/,
        );
        assert.equal(require('../scripts/build-windows-native.cjs'), buildModule);
        assert.equal(require('../scripts/clean-windows-native.cjs'), cleanModule);
        await assertRepositoryGeneratedStateAbsent();
      },
    );

    it(
      'explicit native build authenticates the exact offline Windows toolchain',
      async () => {
        const inputs = await buildTest.authenticateBuildInputs();
        assert.deepEqual(inputs.evidence, {
          platform: 'win32',
          architecture: 'x64',
          nodeVersion: 'v24.13.0',
          modulesAbi: '137',
          runtimeNodeApi: '10',
          addonNodeApi: 8,
          buildToolsVersion: '17.14.37516.0',
          msvcVersion: '14.44.35207',
          compilerVersion: '19.44.35228.0',
          linkerVersion: '14.44.35228.0',
          windowsSdkVersion: '10.0.26100.0',
          nodeHeadersTreeSha256:
            'e2075432b5c246d49178646c8333df2c8c857e0b8638c3809b8cc7659d912df7',
          nodeImportLibraryByteLength: 2_869_366,
          nodeImportLibrarySha256:
            'be205f2934c17fbd56ce6cdfcfbeb2f6a85061d5141e7a58eba240a8477a12fd',
          kernel32ImportLibraryByteLength: 311_908,
          kernel32ImportLibrarySha256:
            '341c7d56125a03b458e4d5093e4c79b33123ccfdfd610fe236937b8e6f3134bb',
        });
        assertBoundedFailure(
          await runNodeScript(BUILD_SCRIPT, ['unexpected']),
        );
        await assertRepositoryGeneratedStateAbsent();
      },
    );

    it(
      'native build creates only the no-replace binary and canonical receipt',
      async () => {
        const result = await runNodeScript(BUILD_SCRIPT);
        assertBoundedSuccess(result);
        assert.equal(result.stderr.length, 0);
        const output = parseCanonicalOutput(result.stdout);
        assert.deepEqual(Object.keys(output), [
          'status',
          'artifact',
          'receipt',
          'artifactSha256',
        ]);
        assert.equal(output.status, 'built');
        assert.equal(output.artifact, internal.ARTIFACT_RELATIVE);
        assert.equal(output.receipt, internal.RECEIPT_RELATIVE);
        assert.match(output.artifactSha256, /^[0-9a-f]{64}$/);
        repositoryBuildOwned = true;
        assert.deepEqual(await releaseEntries(), [
          'moxley-windows-reparse.node',
          'moxley-windows-reparse.receipt.json',
        ]);
        const artifact = await fsp.readFile(ARTIFACT);
        assert.equal(sha256(artifact), output.artifactSha256);
      },
    );

    it(
      'canonical native receipt authenticates source headers libraries and artifact',
      async () => {
        const bytes = await fsp.readFile(RECEIPT);
        const receipt = buildTest.decodeReceiptBytes(bytes);
        assert.equal(`${JSON.stringify(receipt)}\n`, bytes.toString('utf8'));
        const source = await fsp.readFile(SOURCE);
        const artifact = await fsp.readFile(ARTIFACT);
        assert.equal(receipt.source.byteLength, source.length);
        assert.equal(receipt.source.sha256, sha256(source));
        assert.equal(
          receipt.toolchain.nodeHeadersTreeSha256,
          await independentHeaderLedger(),
        );
        assert.equal(
          receipt.toolchain.nodeImportLibraryByteLength,
          2_869_366,
        );
        assert.equal(
          receipt.toolchain.nodeImportLibrarySha256,
          'be205f2934c17fbd56ce6cdfcfbeb2f6a85061d5141e7a58eba240a8477a12fd',
        );
        assert.equal(
          receipt.toolchain.kernel32ImportLibraryByteLength,
          311_908,
        );
        assert.equal(
          receipt.toolchain.kernel32ImportLibrarySha256,
          '341c7d56125a03b458e4d5093e4c79b33123ccfdfd610fe236937b8e6f3134bb',
        );
        assert.equal(receipt.artifact.byteLength, artifact.length);
        assert.equal(receipt.artifact.sha256, sha256(artifact));
      },
    );

    it(
      'promoted native addon is verified while the exclusive build lock remains held',
      async () => {
        assert.equal(await exists(ARTIFACT), true);
        assert.equal(await exists(RECEIPT), true);
        const sandbox = await createSandbox();
        const result = await buildTest.exercisePromotionScenario(
          sandbox,
          'success',
        );
        assert.equal(result.failed, false);
        assert.deepEqual(result.observations, {
          receiptVerificationLockHeld: true,
          artifactVerificationLockHeld: true,
          finalProbeLockHeld: true,
          stagingRemovedBeforeLock: true,
          leaseClosed: true,
        });
        assert.equal(await exists(result.paths.artifact), true);
        assert.equal(await exists(result.paths.receipt), true);
        assert.equal(await exists(result.paths.staging), false);
        assert.equal(await exists(result.paths.lock), false);
        await removeSandbox(sandbox);
      },
    );

    it(
      'existing final output causes collision failure without replacement',
      async () => {
        const artifactBefore = await fsp.readFile(ARTIFACT);
        const receiptBefore = await fsp.readFile(RECEIPT);
        const result = await runNodeScript(BUILD_SCRIPT);
        assertBoundedFailure(result);
        assert.match(
          result.stderr.toString('utf8'),
          /^MOXLEY_NATIVE_BUILD_COLLISION:/,
        );
        assert.deepEqual(await fsp.readFile(ARTIFACT), artifactBefore);
        assert.deepEqual(await fsp.readFile(RECEIPT), receiptBefore);
        assert.equal(await exists(LOCK), false);
        assert.deepEqual(
          (await releaseEntries()).filter((name) =>
            name.startsWith(STAGING_PREFIX),
          ),
          [],
        );
      },
    );

    it(
      'a concurrent build lease rejects a second build and clean operation',
      async () => {
        const identity = await buildTest.repositoryLeaseIdentity();
        liveServer = await startServer(identity.pipeName);
        const stagingName = `${STAGING_PREFIX}${'b'.repeat(32)}`;
        const record = internal.createLockRecord(
          identity.repositoryKey,
          identity.pipeName,
          stagingName,
          'c'.repeat(32),
        );
        internal.validateLockRecord(
          record,
          identity.repositoryKey,
          identity.pipeName,
        );
        await fsp.writeFile(LOCK, internal.canonicalJson(record), {
          encoding: 'utf8',
          flag: 'wx',
        });
        liveLockOwned = true;
        const artifactBefore = await fsp.readFile(ARTIFACT);
        const receiptBefore = await fsp.readFile(RECEIPT);
        const buildResult = await runNodeScript(BUILD_SCRIPT);
        assertBoundedFailure(buildResult);
        assert.match(
          buildResult.stderr.toString('utf8'),
          /^MOXLEY_NATIVE_BUILD_BUSY:/,
        );
        const cleanResult = await runNodeScript(CLEAN_SCRIPT);
        assertBoundedFailure(cleanResult);
        assert.match(
          cleanResult.stderr.toString('utf8'),
          /^MOXLEY_NATIVE_CLEAN_BUSY:/,
        );
        assert.deepEqual(await fsp.readFile(ARTIFACT), artifactBefore);
        assert.deepEqual(await fsp.readFile(RECEIPT), receiptBefore);
        assert.equal(await exists(LOCK), true);
        await closeServer(liveServer);
        liveServer = null;
        await fsp.unlink(LOCK);
        liveLockOwned = false;
      },
    );

    it(
      'handled pre-promotion failure removes staging and lock without final output',
      async () => {
        const cases = [
          {
            mode: 'pre',
            code: 'MOXLEY_NATIVE_BUILD_INJECTED_FAILURE',
            reason: null,
            artifact: 'absent',
            receipt: 'absent',
            staging: 'absent',
            lock: 'absent',
          },
          {
            mode: 'termination-unconfirmed-pre',
            code: SUBPROCESS_CODES.termination,
            reason: 'SUBPROCESS_TERMINATION_NOT_CONFIRMED',
            causeReason: 'SUBPROCESS_TIMEOUT',
            artifact: 'absent',
            receipt: 'absent',
            staging: 'directory',
            lock: 'file',
          },
        ];
        for (const expected of cases) {
          const sandbox = await createSandbox();
          const result = await buildTest.exercisePromotionScenario(
            sandbox,
            expected.mode,
          );
          assert.equal(result.failed, true);
          assert.equal(result.code, expected.code);
          if (expected.reason !== null) {
            assert.equal(result.reason, expected.reason);
            assert.equal(result.terminationConfirmed, false);
            assert.equal(result.causeReason, expected.causeReason);
          }
          assert.equal(result.observations.leaseClosed, true);
          const inventory = await inventoryPromotionScenario(result);
          assert.equal(inventory.artifact, expected.artifact);
          assert.equal(inventory.receipt, expected.receipt);
          assert.equal(inventory.staging, expected.staging);
          assert.equal(inventory.lock, expected.lock);
          assert.equal(inventory.pipe, 'absent');
          assert.equal(inventory.processEvidenceConfirmed, true);
          assert.equal(inventory.taskOwnedProcessCount, 0);
          await removeSandbox(sandbox);
        }
      },
    );

    it(
      'handled post-promotion failure preserves generated evidence for explicit clean',
      async () => {
        const cases = [
          {
            mode: 'post',
            code: 'MOXLEY_NATIVE_BUILD_INJECTED_FAILURE',
            reason: null,
          },
          {
            mode: 'termination-unconfirmed-post',
            code: SUBPROCESS_CODES.termination,
            reason: 'SUBPROCESS_TERMINATION_NOT_CONFIRMED',
            causeReason: 'SUBPROCESS_TIMEOUT',
          },
        ];
        for (const expected of cases) {
          const sandbox = await createSandbox();
          const result = await buildTest.exercisePromotionScenario(
            sandbox,
            expected.mode,
          );
          assert.equal(result.failed, true);
          assert.equal(result.code, expected.code);
          if (expected.reason !== null) {
            assert.equal(result.reason, expected.reason);
            assert.equal(result.terminationConfirmed, false);
            assert.equal(result.causeReason, expected.causeReason);
          }
          assert.equal(result.observations.leaseClosed, true);
          const inventory = await inventoryPromotionScenario(result);
          assert.equal(inventory.artifact, 'file');
          assert.equal(inventory.receipt, 'absent');
          assert.equal(inventory.staging, 'directory');
          assert.equal(inventory.lock, 'file');
          assert.equal(inventory.pipe, 'absent');
          assert.equal(inventory.processEvidenceConfirmed, true);
          assert.equal(inventory.taskOwnedProcessCount, 0);
          await removeSandbox(sandbox);
        }
      },
    );

    it(
      'explicit native clean removes only authenticated generated state and is idempotent',
      async () => {
        assertBoundedFailure(
          await runNodeScript(CLEAN_SCRIPT, ['unexpected']),
        );
        const clean = await runNodeScript(CLEAN_SCRIPT);
        assertBoundedSuccess(clean);
        assert.equal(clean.stderr.length, 0);
        assert.deepEqual(parseCanonicalOutput(clean.stdout), {
          status: 'clean',
          removed: [
            internal.ARTIFACT_RELATIVE,
            internal.RECEIPT_RELATIVE,
          ],
        });
        repositoryBuildOwned = false;
        await assertRepositoryGeneratedStateAbsent();
        const second = await runNodeScript(CLEAN_SCRIPT);
        assertBoundedSuccess(second);
        assert.equal(second.stderr.length, 0);
        assert.deepEqual(parseCanonicalOutput(second.stdout), {
          status: 'clean',
          removed: [],
        });
        await assertRepositoryGeneratedStateAbsent();
      },
    );
  },
);
