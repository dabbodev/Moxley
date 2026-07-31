'use strict';

const { spawn } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { TextDecoder } = require('node:util');

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const SOURCE_RELATIVE = 'native/windows-reparse-classifier.c';
const ARTIFACT_RELATIVE =
  'build/Release/moxley-windows-reparse.node';
const RECEIPT_RELATIVE =
  'build/Release/moxley-windows-reparse.receipt.json';
const LOCK_RELATIVE =
  'build/Release/.moxley-windows-reparse-build.lock';
const STAGING_PREFIX = '.moxley-windows-reparse-stage-';
const LOCK_FORMAT = 'moxley-native-build-lock';
const RECEIPT_FORMAT = 'moxley-native-build-receipt';
const BUILD_TOOLS_VERSION = '17.14.37516.0';
const MSVC_VERSION = '14.44.35207';
const COMPILER_VERSION = '19.44.35228.0';
const LINKER_VERSION = '14.44.35228.0';
const WINDOWS_SDK_VERSION = '10.0.26100.0';
const VS_ROOT =
  'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools';
const VSWHERE_EXE =
  'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
const MSVC_ROOT = path.join(VS_ROOT, 'VC', 'Tools', 'MSVC', MSVC_VERSION);
const MSVC_BIN = path.join(MSVC_ROOT, 'bin', 'Hostx64', 'x64');
const CL_EXE = path.join(MSVC_BIN, 'cl.exe');
const LINK_EXE = path.join(MSVC_BIN, 'link.exe');
const MSVC_INCLUDE = path.join(MSVC_ROOT, 'include');
const MSVC_LIB = path.join(MSVC_ROOT, 'lib', 'x64');
const WINDOWS_SDK_ROOT = 'C:\\Program Files (x86)\\Windows Kits\\10';
const WINDOWS_SDK_INCLUDE = path.join(
  WINDOWS_SDK_ROOT,
  'Include',
  WINDOWS_SDK_VERSION,
);
const WINDOWS_SDK_LIB = path.join(
  WINDOWS_SDK_ROOT,
  'Lib',
  WINDOWS_SDK_VERSION,
);
const KERNEL32_LIB = path.join(
  WINDOWS_SDK_LIB,
  'um',
  'x64',
  'Kernel32.Lib',
);
const POWERSHELL_EXE = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
const FSUTIL_EXE = 'C:\\Windows\\System32\\fsutil.exe';
const SYSTEM32 = 'C:\\Windows\\System32';
const EXPECTED_NODE_LIB = Object.freeze({
  byteLength: 2_869_366,
  sha256:
    'be205f2934c17fbd56ce6cdfcfbeb2f6a85061d5141e7a58eba240a8477a12fd',
});
const EXPECTED_KERNEL32_LIB = Object.freeze({
  byteLength: 311_908,
  sha256:
    '341c7d56125a03b458e4d5093e4c79b33123ccfdfd610fe236937b8e6f3134bb',
});
const REQUIRED_NODE_HEADERS = Object.freeze([
  'node_api.h',
  'node_api_types.h',
  'js_native_api.h',
  'js_native_api_types.h',
  'node_version.h',
]);
const PROCESS_TIMEOUT_MS = 30_000;
const PROBE_TIMEOUT_MS = 10_000;
const MAX_PROCESS_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_JSON_BYTES = 16 * 1024;
const HEX_32 = /^[0-9a-f]{32}$/;
const HEX_64 = /^[0-9a-f]{64}$/;
const EXPECTED_RESULT_KEYS = Object.freeze([
  'outcome',
  'fileAttributes',
  'reparseTag',
  'win32Error',
  'closeWin32Error',
]);
const RECEIPT_KEYS = Object.freeze([
  'receiptFormat',
  'receiptVersion',
  'nativeContractVersion',
  'target',
  'source',
  'toolchain',
  'artifact',
]);
const STAGING_FILE_NAMES = Object.freeze([
  'moxley-windows-reparse-compile.pdb',
  'moxley-windows-reparse-compile.rsp',
  'moxley-windows-reparse-link.rsp',
  'moxley-windows-reparse-probe.txt',
  'moxley-windows-reparse.exp',
  'moxley-windows-reparse.lib',
  'moxley-windows-reparse.node',
  'moxley-windows-reparse.obj',
  'moxley-windows-reparse.pdb',
  'moxley-windows-reparse.receipt.json',
]);

const PROBE_WORKER_SOURCE = String.raw`
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { TextDecoder } = require('node:util');
const expectedKeys = ['outcome','fileAttributes','reparseTag','win32Error','closeWin32Error'];
let chunks = [];
let length = 0;
function fail() { process.exitCode = 1; }
function canonical(bytes) {
  if (bytes.length === 0 || bytes.length > 65536 || bytes[0] === 0xef) throw new Error();
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (!text.endsWith('\n') || text.includes('\r') || text.indexOf('\n') !== text.length - 1) throw new Error();
  const value = JSON.parse(text.slice(0, -1));
  if (JSON.stringify(value) + '\n' !== text) throw new Error();
  return value;
}
function uint32(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}
process.stdin.on('data', (chunk) => {
  length += chunk.length;
  if (length > 65536) { chunks = []; process.stdin.destroy(); fail(); return; }
  chunks.push(chunk);
});
process.stdin.on('error', fail);
process.stdin.on('end', () => {
  try {
    const request = canonical(Buffer.concat(chunks));
    if (JSON.stringify(Object.keys(request)) !== JSON.stringify(['requestFormat','requestVersion','addonPath','probePath'])) throw new Error();
    if (request.requestFormat !== 'moxley-native-build-probe' || request.requestVersion !== 1) throw new Error();
    if (typeof request.addonPath !== 'string' || typeof request.probePath !== 'string') throw new Error();
    if (!path.isAbsolute(request.addonPath) || !path.isAbsolute(request.probePath)) throw new Error();
    if (request.addonPath.length > 1024 || request.probePath.length > 1024) throw new Error();
    if (!fs.statSync(request.probePath).isFile()) throw new Error();
    const addon = require(request.addonPath);
    const addonKeys = Reflect.ownKeys(addon);
    if (addonKeys.length !== 1 || addonKeys[0] !== 'classify') throw new Error();
    const descriptor = Object.getOwnPropertyDescriptor(addon, 'classify');
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') throw new Error();
    const result = descriptor.value(request.probePath);
    if (result === null || typeof result !== 'object' || Object.getPrototypeOf(result) !== Object.prototype) throw new Error();
    const keys = Reflect.ownKeys(result);
    if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) throw new Error();
    const accepted = {};
    for (const key of expectedKeys) {
      const item = Object.getOwnPropertyDescriptor(result, key);
      if (!item || !item.enumerable || !Object.hasOwn(item, 'value') || Object.hasOwn(item, 'get') || Object.hasOwn(item, 'set')) throw new Error();
      accepted[key] = item.value;
    }
    if (accepted.outcome !== 'ordinary') throw new Error();
    for (const key of expectedKeys.slice(1)) if (!uint32(accepted[key])) throw new Error();
    if ((accepted.fileAttributes & 0x00000400) !== 0 || accepted.reparseTag !== 0 || accepted.win32Error !== 0 || accepted.closeWin32Error !== 0) throw new Error();
    process.stdout.write(JSON.stringify({ status: 'probed', result: accepted }) + '\n');
  } catch { fail(); }
});
`;

class NativeBuildError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'NativeBuildError';
    this.code = code;
  }
}

function buildError(code, message) {
  return new NativeBuildError(code, message);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalJson(value) {
  return `${JSON.stringify(value)}\n`;
}

function ordinalCompare(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function sameWindowsPath(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function isStrictDescendant(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative !== '' &&
    !path.isAbsolute(relative) &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`)
  );
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value)) === JSON.stringify(keys)
  );
}

function decodeCanonicalJson(bytes, maxBytes = MAX_JSON_BYTES) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > maxBytes) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_EVIDENCE_INVALID',
      'Canonical native build evidence is invalid.',
    );
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_EVIDENCE_INVALID',
      'Canonical native build evidence is invalid.',
    );
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_EVIDENCE_INVALID',
      'Canonical native build evidence is invalid.',
    );
  }
  if (
    !text.endsWith('\n') ||
    text.includes('\r') ||
    text.indexOf('\n') !== text.length - 1
  ) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_EVIDENCE_INVALID',
      'Canonical native build evidence is invalid.',
    );
  }
  let value;
  try {
    value = JSON.parse(text.slice(0, -1));
  } catch {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_EVIDENCE_INVALID',
      'Canonical native build evidence is invalid.',
    );
  }
  if (canonicalJson(value) !== text) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_EVIDENCE_INVALID',
      'Canonical native build evidence is invalid.',
    );
  }
  return value;
}

function runProcess(file, arguments_, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, arguments_, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    let stdoutLength = 0;
    let stderrLength = 0;
    let settled = false;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs ?? PROCESS_TIMEOUT_MS);

    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(result);
    }

    child.once('error', (error) => finish(error));
    child.stdout.on('data', (chunk) => {
      stdoutLength += chunk.length;
      if (stdoutLength > MAX_PROCESS_OUTPUT_BYTES) {
        child.kill();
      } else {
        stdout.push(chunk);
      }
    });
    child.stderr.on('data', (chunk) => {
      stderrLength += chunk.length;
      if (stderrLength > MAX_PROCESS_OUTPUT_BYTES) {
        child.kill();
      } else {
        stderr.push(chunk);
      }
    });
    child.once('close', (code, signal) => {
      if (
        timedOut ||
        stdoutLength > MAX_PROCESS_OUTPUT_BYTES ||
        stderrLength > MAX_PROCESS_OUTPUT_BYTES
      ) {
        finish(
          buildError(
            'MOXLEY_NATIVE_BUILD_SUBPROCESS_FAILED',
            'A bounded native build subprocess failed.',
          ),
        );
        return;
      }
      finish(null, {
        code,
        signal,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      });
    });

    if (options.stdin === undefined) child.stdin.end();
    else child.stdin.end(options.stdin);
  });
}

async function requireProcessSuccess(label, file, arguments_, options) {
  let result;
  try {
    result = await runProcess(file, arguments_, options);
  } catch {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_SUBPROCESS_FAILED',
      `${label} failed.`,
    );
  }
  if (result.code !== 0 || result.signal !== null) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_SUBPROCESS_FAILED',
      `${label} failed.`,
    );
  }
  const output = Buffer.concat([result.stdout, result.stderr]).toString('utf8');
  if (/\bwarning\b/i.test(output)) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_SUBPROCESS_FAILED',
      `${label} emitted a warning.`,
    );
  }
  return result;
}

function encodedPowerShell(command) {
  return Buffer.from(command, 'utf16le').toString('base64');
}

async function runPowerShellJson(command, environment) {
  const result = await requireProcessSuccess(
    'Read-only Windows authentication',
    POWERSHELL_EXE,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      encodedPowerShell(command),
    ],
    {
      env: { ...process.env, ...environment },
      timeoutMs: PROCESS_TIMEOUT_MS,
    },
  );
  const stdout = result.stdout.toString('utf8').trim();
  if (result.stderr.length !== 0 || stdout.length === 0 || stdout.length > 4096) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_INPUT_INVALID',
      'Exact native build inputs were not authenticated.',
    );
  }
  try {
    return JSON.parse(stdout);
  } catch {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_INPUT_INVALID',
      'Exact native build inputs were not authenticated.',
    );
  }
}

async function assertNoReparse(target) {
  let result;
  try {
    result = await runProcess(FSUTIL_EXE, ['reparsepoint', 'query', target], {
      timeoutMs: PROCESS_TIMEOUT_MS,
    });
  } catch {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_PATH_INVALID',
      'A native build path could not be authenticated.',
    );
  }
  if (
    result.code !== 1 ||
    result.signal !== null ||
    result.stderr.length !== 0 ||
    !result.stdout.toString('utf8').startsWith('Error 4390:')
  ) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_PATH_INVALID',
      'A native build path is a reparse point or could not be authenticated.',
    );
  }
}

async function authenticatePath(target, expectedType) {
  let metadata;
  try {
    metadata = await fsp.lstat(target, { bigint: true });
  } catch {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_PATH_INVALID',
      'A native build path could not be authenticated.',
    );
  }
  const correctType =
    expectedType === 'file' ? metadata.isFile() : metadata.isDirectory();
  if (!correctType || metadata.isSymbolicLink()) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_PATH_INVALID',
      'A native build path has an unexpected type.',
    );
  }
  await assertNoReparse(target);
  const canonical = await fsp.realpath(target);
  if (!sameWindowsPath(canonical, target)) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_PATH_INVALID',
      'A native build path has an unexpected canonical identity.',
    );
  }
  return metadata;
}

function identityOf(metadata) {
  return Object.freeze({
    dev: metadata.dev,
    ino: metadata.ino,
    size: metadata.size,
    type: metadata.isFile() ? 'file' : 'directory',
  });
}

function sameIdentity(metadata, identity, includeSize = true) {
  return (
    metadata.dev === identity.dev &&
    metadata.ino === identity.ino &&
    (!includeSize || metadata.size === identity.size) &&
    (identity.type === 'file' ? metadata.isFile() : metadata.isDirectory()) &&
    !metadata.isSymbolicLink()
  );
}

async function assertAbsent(target, collision = false) {
  try {
    await fsp.lstat(target);
  } catch (error) {
    if (error && error.code === 'ENOENT') return;
    throw buildError(
      'MOXLEY_NATIVE_BUILD_PATH_INVALID',
      'A native build output path could not be authenticated.',
    );
  }
  throw buildError(
    collision
      ? 'MOXLEY_NATIVE_BUILD_COLLISION'
      : 'MOXLEY_NATIVE_BUILD_PATH_INVALID',
    collision
      ? 'Generated native output already exists; run explicit clean.'
      : 'A native build path was expected to be absent.',
  );
}

async function ensureOrdinaryDirectory(target, parent) {
  if (!isStrictDescendant(parent, target)) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_PATH_INVALID',
      'A native build directory is outside the package boundary.',
    );
  }
  try {
    await fsp.mkdir(target, { recursive: false });
  } catch (error) {
    if (!error || error.code !== 'EEXIST') {
      throw buildError(
        'MOXLEY_NATIVE_BUILD_PATH_INVALID',
        'A native build directory could not be created.',
      );
    }
  }
  return authenticatePath(target, 'directory');
}

function packagePaths(root, stagingName) {
  const release = path.join(root, 'build', 'Release');
  const staging = path.join(release, stagingName);
  return Object.freeze({
    root,
    source: path.join(root, ...SOURCE_RELATIVE.split('/')),
    build: path.join(root, 'build'),
    release,
    artifact: path.join(root, ...ARTIFACT_RELATIVE.split('/')),
    receipt: path.join(root, ...RECEIPT_RELATIVE.split('/')),
    lock: path.join(root, ...LOCK_RELATIVE.split('/')),
    staging,
    stagedAddon: path.join(staging, 'moxley-windows-reparse.node'),
    stagedReceipt: path.join(
      staging,
      'moxley-windows-reparse.receipt.json',
    ),
    object: path.join(staging, 'moxley-windows-reparse.obj'),
    importLibrary: path.join(staging, 'moxley-windows-reparse.lib'),
    exportFile: path.join(staging, 'moxley-windows-reparse.exp'),
    compilePdb: path.join(staging, 'moxley-windows-reparse-compile.pdb'),
    linkPdb: path.join(staging, 'moxley-windows-reparse.pdb'),
    compileResponse: path.join(
      staging,
      'moxley-windows-reparse-compile.rsp',
    ),
    linkResponse: path.join(staging, 'moxley-windows-reparse-link.rsp'),
    probeFile: path.join(staging, 'moxley-windows-reparse-probe.txt'),
  });
}

function repositoryKey(canonicalRoot) {
  return sha256(Buffer.from(canonicalRoot.toLowerCase(), 'utf8'));
}

function pipeNameForKey(key) {
  return `\\\\.\\pipe\\moxley-native-build-${key.slice(0, 32)}`;
}

function createLockRecord(key, pipeName, stagingName, nonce) {
  return {
    lockFormat: LOCK_FORMAT,
    lockVersion: 1,
    repositoryKey: key,
    pipeName,
    stagingName,
    nonce,
  };
}

function validateLockRecord(value, expectedKey, expectedPipe) {
  if (
    !exactKeys(value, [
      'lockFormat',
      'lockVersion',
      'repositoryKey',
      'pipeName',
      'stagingName',
      'nonce',
    ]) ||
    value.lockFormat !== LOCK_FORMAT ||
    value.lockVersion !== 1 ||
    value.repositoryKey !== expectedKey ||
    !HEX_64.test(value.repositoryKey) ||
    value.pipeName !== expectedPipe ||
    value.stagingName !== `${STAGING_PREFIX}${value.stagingName.slice(-32)}` ||
    !HEX_32.test(value.stagingName.slice(STAGING_PREFIX.length)) ||
    !HEX_32.test(value.nonce)
  ) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_LOCK_INVALID',
      'Native build lock evidence is invalid.',
    );
  }
  return value;
}

function decodeLockBytes(bytes, expectedKey, expectedPipe) {
  return validateLockRecord(
    decodeCanonicalJson(bytes, 2048),
    expectedKey,
    expectedPipe,
  );
}

async function startLease(pipeName) {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => socket.destroy());
    let settled = false;
    server.once('error', () => {
      if (!settled) {
        settled = true;
        reject(
          buildError(
            'MOXLEY_NATIVE_BUILD_BUSY',
            'Native build is already active or locked.',
          ),
        );
      }
    });
    server.listen(pipeName, () => {
      if (settled) return;
      settled = true;
      resolve({
        server,
        close() {
          return new Promise((resolveClose) => server.close(resolveClose));
        },
      });
    });
  });
}

async function acquireLock(lockPath, bytes, state) {
  let handle;
  try {
    handle = await fsp.open(lockPath, 'wx', 0o600);
    state.lockOwned = true;
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      throw buildError(
        'MOXLEY_NATIVE_BUILD_BUSY',
        'Native build is already active or locked.',
      );
    }
    throw buildError(
      'MOXLEY_NATIVE_BUILD_LOCK_FAILED',
      'Native build lock creation failed.',
    );
  } finally {
    if (handle !== undefined) await handle.close().catch(() => {});
  }
  const metadata = await authenticatePath(lockPath, 'file');
  state.lockIdentity = identityOf(metadata);
  const actual = await fsp.readFile(lockPath);
  if (!actual.equals(bytes)) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_LOCK_FAILED',
      'Native build lock verification failed.',
    );
  }
}

async function releaseOwnedLock(state) {
  if (!state.lockOwned) return;
  let metadata;
  try {
    metadata = await fsp.lstat(state.paths.lock, { bigint: true });
  } catch {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_LOCK_RELEASE_FAILED',
      'Native build lock release failed.',
    );
  }
  if (!sameIdentity(metadata, state.lockIdentity)) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_LOCK_RELEASE_FAILED',
      'Native build lock identity changed.',
    );
  }
  await assertNoReparse(state.paths.lock);
  try {
    await fsp.unlink(state.paths.lock);
  } catch {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_LOCK_RELEASE_FAILED',
      'Native build lock release failed.',
    );
  }
  await assertAbsent(state.paths.lock);
  state.lockOwned = false;
}

async function authenticateHost(canonicalRoot) {
  const driveRoot = path.parse(canonicalRoot).root;
  if (!/^[A-Za-z]:\\$/.test(driveRoot)) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_INPUT_INVALID',
      'Exact native build inputs were not authenticated.',
    );
  }
  const host = await runPowerShellJson(
    String.raw`$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$OutputEncoding=[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$os=Get-CimInstance -ClassName Win32_OperatingSystem
$cv=Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$drive=[System.IO.DriveInfo]::new($env:MOXLEY_BUILD_DRIVE_ROOT)
$value=[ordered]@{caption=$os.Caption;displayVersion=$cv.DisplayVersion;build=($cv.CurrentBuildNumber+'.'+$cv.UBR);driveType=([string]$drive.DriveType);driveFormat=$drive.DriveFormat}
[Console]::Out.Write(($value | ConvertTo-Json -Compress))`,
    { MOXLEY_BUILD_DRIVE_ROOT: driveRoot },
  );
  if (
    !exactKeys(host, [
      'caption',
      'displayVersion',
      'build',
      'driveType',
      'driveFormat',
    ]) ||
    host.caption !== 'Microsoft Windows 11 Home' ||
    host.displayVersion !== '25H2' ||
    host.build !== '26200.8875' ||
    host.driveType !== 'Fixed' ||
    host.driveFormat !== 'NTFS'
  ) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_INPUT_INVALID',
      'Exact Windows host and filesystem were not authenticated.',
    );
  }
}

async function authenticatePackageRoot() {
  if (
    process.platform !== 'win32' ||
    process.arch !== 'x64' ||
    process.version !== 'v24.13.0' ||
    process.versions.modules !== '137' ||
    process.versions.napi !== '10'
  ) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_INPUT_INVALID',
      'Exact Node runtime inputs were not authenticated.',
    );
  }
  await authenticatePath(PACKAGE_ROOT, 'directory');
  await authenticatePath(__dirname, 'directory');
  await authenticatePath(__filename, 'file');
  const canonicalRoot = await fsp.realpath(PACKAGE_ROOT);
  if (!sameWindowsPath(canonicalRoot, PACKAGE_ROOT)) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_PATH_INVALID',
      'The package root has an unexpected canonical identity.',
    );
  }
  const manifestPath = path.join(canonicalRoot, 'package.json');
  await authenticatePath(manifestPath, 'file');
  let manifest;
  try {
    manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  } catch {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_INPUT_INVALID',
      'The package manifest could not be authenticated.',
    );
  }
  const lifecycleNames = [
    'install',
    'preinstall',
    'postinstall',
    'prepare',
    'prepublish',
    'prepublishOnly',
  ];
  if (
    manifest.name !== 'moxley-db' ||
    manifest.version !== '3.1.1' ||
    manifest.license !== 'Apache-2.0' ||
    manifest.main !== 'index.js' ||
    manifest.scripts?.['build:native:windows'] !==
      'node scripts/build-windows-native.cjs' ||
    manifest.scripts?.['clean:native:windows'] !==
      'node scripts/clean-windows-native.cjs' ||
    lifecycleNames.some((name) => Object.hasOwn(manifest.scripts ?? {}, name))
  ) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_INPUT_INVALID',
      'The package manifest could not be authenticated.',
    );
  }
  await authenticateHost(canonicalRoot);
  return canonicalRoot;
}

async function authenticateRegularFile(target, expected) {
  const metadata = await authenticatePath(target, 'file');
  const byteLength = Number(metadata.size);
  const bytes = await fsp.readFile(target);
  const hash = sha256(bytes);
  if (
    !Number.isSafeInteger(byteLength) ||
    byteLength !== expected.byteLength ||
    hash !== expected.sha256
  ) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_INPUT_INVALID',
      'An exact native import library did not authenticate.',
    );
  }
  return { byteLength, sha256: hash };
}

function requireSdkDeclarations(textByName) {
  const declarations = [
    [
      'fileapi.h',
      /CreateFileW\(\s*_In_ LPCWSTR lpFileName,\s*_In_ DWORD dwDesiredAccess,\s*_In_ DWORD dwShareMode,\s*_In_opt_ LPSECURITY_ATTRIBUTES lpSecurityAttributes,\s*_In_ DWORD dwCreationDisposition,\s*_In_ DWORD dwFlagsAndAttributes,\s*_In_opt_ HANDLE hTemplateFile\s*\);/m,
    ],
    [
      'WinBase.h',
      /GetFileInformationByHandleEx\(\s*_In_\s+HANDLE hFile,\s*_In_\s+FILE_INFO_BY_HANDLE_CLASS FileInformationClass,\s*_Out_writes_bytes_\(dwBufferSize\) LPVOID lpFileInformation,\s*_In_\s+DWORD dwBufferSize\s*\);/m,
    ],
    [
      'WinBase.h',
      /typedef struct _FILE_ATTRIBUTE_TAG_INFO \{\s*DWORD FileAttributes;\s*DWORD ReparseTag;\s*\} FILE_ATTRIBUTE_TAG_INFO, \*PFILE_ATTRIBUTE_TAG_INFO;/m,
    ],
    ['minwinbase.h', /^\s*FileAttributeTagInfo,\s*$/m],
    ['winnt.h', /^#define FILE_ATTRIBUTE_REPARSE_POINT\s+0x00000400\s*$/m],
    ['WinBase.h', /^#define FILE_FLAG_OPEN_REPARSE_POINT\s+0x00200000\s*$/m],
    ['WinBase.h', /^#define FILE_FLAG_BACKUP_SEMANTICS\s+0x02000000\s*$/m],
  ];
  for (const [name, declaration] of declarations) {
    if (!declaration.test(textByName.get(name))) {
      throw buildError(
        'MOXLEY_NATIVE_BUILD_INPUT_INVALID',
        'Required Windows SDK declarations did not authenticate.',
      );
    }
  }
}

async function nodeHeadersLedger(nodeInclude) {
  const names = [...REQUIRED_NODE_HEADERS].sort(ordinalCompare);
  const rows = [];
  for (const name of names) {
    const headerPath = path.join(nodeInclude, name);
    await authenticatePath(headerPath, 'file');
    const bytes = await fsp.readFile(headerPath);
    rows.push(
      Buffer.concat([
        Buffer.from(name, 'utf8'),
        Buffer.from([0]),
        Buffer.from(String(bytes.length), 'utf8'),
        Buffer.from([0]),
        Buffer.from(sha256(bytes), 'utf8'),
        Buffer.from('\n', 'utf8'),
      ]),
    );
  }
  return sha256(Buffer.concat(rows));
}

async function authenticateToolchain(canonicalRoot) {
  const localAppData = process.env.LOCALAPPDATA;
  if (
    typeof localAppData !== 'string' ||
    !path.isAbsolute(localAppData) ||
    localAppData.length > 512
  ) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_INPUT_INVALID',
      'Exact cached Node inputs were not authenticated.',
    );
  }
  const nodeRoot = path.join(
    localAppData,
    'node-gyp',
    'Cache',
    '24.13.0',
  );
  const nodeInclude = path.join(nodeRoot, 'include', 'node');
  const nodeLibrary = path.join(nodeRoot, 'x64', 'node.lib');
  const source = path.join(canonicalRoot, ...SOURCE_RELATIVE.split('/'));

  for (const directory of [
    VS_ROOT,
    MSVC_ROOT,
    MSVC_BIN,
    MSVC_INCLUDE,
    MSVC_LIB,
    WINDOWS_SDK_ROOT,
    WINDOWS_SDK_INCLUDE,
    WINDOWS_SDK_LIB,
    path.join(WINDOWS_SDK_INCLUDE, 'ucrt'),
    path.join(WINDOWS_SDK_INCLUDE, 'shared'),
    path.join(WINDOWS_SDK_INCLUDE, 'um'),
    path.join(WINDOWS_SDK_LIB, 'ucrt', 'x64'),
    path.join(WINDOWS_SDK_LIB, 'um', 'x64'),
    nodeRoot,
    nodeInclude,
  ]) {
    await authenticatePath(directory, 'directory');
  }
  for (const file of [
    VSWHERE_EXE,
    CL_EXE,
    LINK_EXE,
    POWERSHELL_EXE,
    source,
  ]) {
    await authenticatePath(file, 'file');
  }

  const vswhere = await requireProcessSuccess(
    'Visual Studio Build Tools authentication',
    VSWHERE_EXE,
    [
      '-products',
      'Microsoft.VisualStudio.Product.BuildTools',
      '-property',
      'installationVersion',
    ],
    { timeoutMs: PROCESS_TIMEOUT_MS },
  );
  if (
    vswhere.stderr.length !== 0 ||
    vswhere.stdout.toString('utf8').trim() !== BUILD_TOOLS_VERSION
  ) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_INPUT_INVALID',
      'Exact Visual Studio Build Tools were not authenticated.',
    );
  }

  const executableEvidence = await runPowerShellJson(
    String.raw`$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$OutputEncoding=[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$compiler=Get-Item -LiteralPath $env:MOXLEY_BUILD_COMPILER
$linker=Get-Item -LiteralPath $env:MOXLEY_BUILD_LINKER
$compilerSignature=Get-AuthenticodeSignature -LiteralPath $env:MOXLEY_BUILD_COMPILER
$linkerSignature=Get-AuthenticodeSignature -LiteralPath $env:MOXLEY_BUILD_LINKER
$value=[ordered]@{compilerVersion=$compiler.VersionInfo.FileVersion;compilerSignature=([string]$compilerSignature.Status);linkerVersion=$linker.VersionInfo.FileVersion;linkerSignature=([string]$linkerSignature.Status)}
[Console]::Out.Write(($value | ConvertTo-Json -Compress))`,
    {
      MOXLEY_BUILD_COMPILER: CL_EXE,
      MOXLEY_BUILD_LINKER: LINK_EXE,
    },
  );
  if (
    !exactKeys(executableEvidence, [
      'compilerVersion',
      'compilerSignature',
      'linkerVersion',
      'linkerSignature',
    ]) ||
    executableEvidence.compilerVersion !== COMPILER_VERSION ||
    executableEvidence.linkerVersion !== LINKER_VERSION ||
    executableEvidence.compilerSignature !== 'Valid' ||
    executableEvidence.linkerSignature !== 'Valid'
  ) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_INPUT_INVALID',
      'Exact signed MSVC tools were not authenticated.',
    );
  }

  const versionHeaderPath = path.join(nodeInclude, 'node_version.h');
  const versionHeader = await fsp.readFile(versionHeaderPath, 'utf8');
  for (const declaration of [
    /^#define NODE_MAJOR_VERSION 24$/m,
    /^#define NODE_MINOR_VERSION 13$/m,
    /^#define NODE_PATCH_VERSION 0$/m,
    /^#define NODE_MODULE_VERSION 137$/m,
  ]) {
    if (!declaration.test(versionHeader)) {
      throw buildError(
        'MOXLEY_NATIVE_BUILD_INPUT_INVALID',
        'Exact cached Node headers were not authenticated.',
      );
    }
  }

  const sdkNames = ['fileapi.h', 'WinBase.h', 'winnt.h', 'minwinbase.h'];
  const sdkText = new Map();
  for (const name of sdkNames) {
    const header = path.join(WINDOWS_SDK_INCLUDE, 'um', name);
    await authenticatePath(header, 'file');
    sdkText.set(name, await fsp.readFile(header, 'utf8'));
  }
  requireSdkDeclarations(sdkText);

  const sourceText = await fsp.readFile(source, 'utf8');
  if (
    !sourceText.startsWith('// SPDX-License-Identifier: Apache-2.0\n') &&
    !sourceText.startsWith('// SPDX-License-Identifier: Apache-2.0\r\n')
  ) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_INPUT_INVALID',
      'The private production native source was not authenticated.',
    );
  }
  if (
    !/^#define NAPI_VERSION 8$/m.test(sourceText) ||
    !sourceText.includes('MOXLEY_TEST_FORCE_ATTRIBUTE_QUERY_FAILURE')
  ) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_INPUT_INVALID',
      'The private production native source contract was not authenticated.',
    );
  }

  const nodeImport = await authenticateRegularFile(
    nodeLibrary,
    EXPECTED_NODE_LIB,
  );
  const kernel32Import = await authenticateRegularFile(
    KERNEL32_LIB,
    EXPECTED_KERNEL32_LIB,
  );
  const headersTree = await nodeHeadersLedger(nodeInclude);

  return Object.freeze({
    source,
    nodeInclude,
    nodeLibrary,
    nodeHeadersTreeSha256: headersTree,
    nodeImport,
    kernel32Import,
  });
}

async function authenticateBuildInputs() {
  const canonicalRoot = await authenticatePackageRoot();
  const toolchain = await authenticateToolchain(canonicalRoot);
  const key = repositoryKey(canonicalRoot);
  return Object.freeze({
    canonicalRoot,
    repositoryKey: key,
    pipeName: pipeNameForKey(key),
    toolchain,
    evidence: Object.freeze({
      platform: process.platform,
      architecture: process.arch,
      nodeVersion: process.version,
      modulesAbi: process.versions.modules,
      runtimeNodeApi: process.versions.napi,
      addonNodeApi: 8,
      buildToolsVersion: BUILD_TOOLS_VERSION,
      msvcVersion: MSVC_VERSION,
      compilerVersion: COMPILER_VERSION,
      linkerVersion: LINKER_VERSION,
      windowsSdkVersion: WINDOWS_SDK_VERSION,
      nodeHeadersTreeSha256: toolchain.nodeHeadersTreeSha256,
      nodeImportLibraryByteLength: toolchain.nodeImport.byteLength,
      nodeImportLibrarySha256: toolchain.nodeImport.sha256,
      kernel32ImportLibraryByteLength: toolchain.kernel32Import.byteLength,
      kernel32ImportLibrarySha256: toolchain.kernel32Import.sha256,
    }),
  });
}

function quoteResponseArgument(value) {
  if (
    typeof value !== 'string' ||
    value.includes('"') ||
    value.includes('\r') ||
    value.includes('\n')
  ) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_PATH_INVALID',
      'A native build response path is invalid.',
    );
  }
  return `"${value}"`;
}

async function writeBuildResponses(paths, toolchain) {
  const compileArguments = [
    '/TC',
    '/c',
    '/W4',
    '/WX',
    '/O2',
    '/MD',
    '/GS',
    '/sdl',
    '/guard:cf',
    '/utf-8',
    '/DUNICODE',
    '/D_UNICODE',
    '/DNAPI_VERSION=8',
    `/I${quoteResponseArgument(toolchain.nodeInclude)}`,
    `/Fo${quoteResponseArgument(paths.object)}`,
    `/Fd${quoteResponseArgument(paths.compilePdb)}`,
    quoteResponseArgument(paths.source),
  ];
  const linkArguments = [
    '/DLL',
    '/WX',
    '/MACHINE:X64',
    '/DYNAMICBASE',
    '/NXCOMPAT',
    '/GUARD:CF',
    '/INCREMENTAL:NO',
    '/OPT:REF',
    '/OPT:ICF',
    `/OUT:${quoteResponseArgument(paths.stagedAddon)}`,
    `/IMPLIB:${quoteResponseArgument(paths.importLibrary)}`,
    `/PDB:${quoteResponseArgument(paths.linkPdb)}`,
    quoteResponseArgument(paths.object),
    quoteResponseArgument(toolchain.nodeLibrary),
    quoteResponseArgument(KERNEL32_LIB),
  ];
  await fsp.writeFile(
    paths.compileResponse,
    `${compileArguments.join('\r\n')}\r\n`,
    { encoding: 'utf8', flag: 'wx' },
  );
  await fsp.writeFile(
    paths.linkResponse,
    `${linkArguments.join('\r\n')}\r\n`,
    { encoding: 'utf8', flag: 'wx' },
  );
}

function buildEnvironment(paths) {
  return {
    ComSpec: 'C:\\Windows\\System32\\cmd.exe',
    SystemRoot: 'C:\\Windows',
    TEMP: paths.staging,
    TMP: paths.staging,
    INCLUDE: [
      MSVC_INCLUDE,
      path.join(WINDOWS_SDK_INCLUDE, 'ucrt'),
      path.join(WINDOWS_SDK_INCLUDE, 'shared'),
      path.join(WINDOWS_SDK_INCLUDE, 'um'),
    ].join(';'),
    LIB: [
      MSVC_LIB,
      path.join(WINDOWS_SDK_LIB, 'ucrt', 'x64'),
      path.join(WINDOWS_SDK_LIB, 'um', 'x64'),
    ].join(';'),
    PATH: `${MSVC_BIN};${SYSTEM32}`,
  };
}

async function compileProductionAddon(paths, toolchain) {
  await writeBuildResponses(paths, toolchain);
  const environment = buildEnvironment(paths);
  const compile = await requireProcessSuccess(
    'Production native compilation',
    CL_EXE,
    [`@${paths.compileResponse}`],
    { cwd: paths.staging, env: environment },
  );
  const compileOutput = Buffer.concat([
    compile.stdout,
    compile.stderr,
  ]).toString('utf8');
  if (!/Compiler Version 19\.44\.35228 for x64/.test(compileOutput)) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_SUBPROCESS_FAILED',
      'Production native compiler identity changed.',
    );
  }
  await authenticatePath(paths.object, 'file');

  const link = await requireProcessSuccess(
    'Production native linking',
    LINK_EXE,
    [`@${paths.linkResponse}`],
    { cwd: paths.staging, env: environment },
  );
  const linkOutput = Buffer.concat([link.stdout, link.stderr]).toString('utf8');
  if (!/Incremental Linker Version 14\.44\.35228\.0/.test(linkOutput)) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_SUBPROCESS_FAILED',
      'Production native linker identity changed.',
    );
  }
  await authenticatePath(paths.stagedAddon, 'file');
}

async function authenticateStagingDirectory(state) {
  const metadata = await authenticatePath(state.paths.staging, 'directory');
  if (!sameIdentity(metadata, state.stagingIdentity, false)) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_STAGE_INVALID',
      'Native build staging identity changed.',
    );
  }
  return inventoryStagingTree(
    state.paths.staging,
    state.allowedStagingNames,
  );
}

async function inventoryStagingTree(staging, allowedFileNames) {
  const topNames = (await fsp.readdir(staging)).sort(ordinalCompare);
  const files = [];
  const directories = [];
  for (const name of topNames) {
    const target = path.join(staging, name);
    if (allowedFileNames.has(name)) {
      const metadata = await authenticatePath(target, 'file');
      files.push(
        Object.freeze({ target, identity: identityOf(metadata) }),
      );
      continue;
    }
    if (name !== 'Microsoft') {
      throw buildError(
        'MOXLEY_NATIVE_BUILD_STAGE_INVALID',
        'Native build staging contains an unexpected entry.',
      );
    }
    const microsoftMetadata = await authenticatePath(target, 'directory');
    const microsoftChildren = await fsp.readdir(target);
    if (
      microsoftChildren.length !== 1 ||
      microsoftChildren[0] !== 'VSApplicationInsights'
    ) {
      throw buildError(
        'MOXLEY_NATIVE_BUILD_STAGE_INVALID',
        'Native build staging contains unexpected compiler temporary state.',
      );
    }
    const insights = path.join(target, 'VSApplicationInsights');
    const insightsMetadata = await authenticatePath(insights, 'directory');
    const insightChildren = await fsp.readdir(insights);
    if (
      insightChildren.length !== 1 ||
      !/^vstel[0-9a-f]{32}$/.test(insightChildren[0])
    ) {
      throw buildError(
        'MOXLEY_NATIVE_BUILD_STAGE_INVALID',
        'Native build staging contains unexpected compiler temporary state.',
      );
    }
    const telemetryLeaf = path.join(insights, insightChildren[0]);
    const leafMetadata = await authenticatePath(telemetryLeaf, 'directory');
    if ((await fsp.readdir(telemetryLeaf)).length !== 0) {
      throw buildError(
        'MOXLEY_NATIVE_BUILD_STAGE_INVALID',
        'Native build staging contains unexpected compiler temporary state.',
      );
    }
    directories.push(
      Object.freeze({ target: telemetryLeaf, identity: identityOf(leafMetadata) }),
      Object.freeze({ target: insights, identity: identityOf(insightsMetadata) }),
      Object.freeze({ target, identity: identityOf(microsoftMetadata) }),
    );
  }
  return Object.freeze({
    files: Object.freeze(files),
    directories: Object.freeze(directories),
  });
}

async function removeAuthenticatedStaging(state) {
  if (!state.stagingCreated) return;
  const inventory = await authenticateStagingDirectory(state);
  for (const item of inventory.files) {
    const metadata = await fsp.lstat(item.target, { bigint: true });
    if (!sameIdentity(metadata, item.identity)) {
      throw buildError(
        'MOXLEY_NATIVE_BUILD_STAGE_INVALID',
        'Native build staging entry identity changed.',
      );
    }
    await assertNoReparse(item.target);
    await fsp.unlink(item.target);
    await assertAbsent(item.target);
  }
  for (const item of inventory.directories) {
    const metadata = await fsp.lstat(item.target, { bigint: true });
    if (!sameIdentity(metadata, item.identity, false)) {
      throw buildError(
        'MOXLEY_NATIVE_BUILD_STAGE_INVALID',
        'Native build staging directory identity changed.',
      );
    }
    await assertNoReparse(item.target);
    await fsp.rmdir(item.target);
    await assertAbsent(item.target);
  }
  const directory = await fsp.lstat(state.paths.staging, { bigint: true });
  if (!sameIdentity(directory, state.stagingIdentity, false)) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_STAGE_INVALID',
      'Native build staging identity changed.',
    );
  }
  await assertNoReparse(state.paths.staging);
  await fsp.rmdir(state.paths.staging);
  await assertAbsent(state.paths.staging);
  state.stagingCreated = false;
}

async function runProbe(addonPath, probePath) {
  const request = canonicalJson({
    requestFormat: 'moxley-native-build-probe',
    requestVersion: 1,
    addonPath,
    probePath,
  });
  const result = await runProcess(
    process.execPath,
    ['-e', PROBE_WORKER_SOURCE],
    {
      stdin: Buffer.from(request, 'utf8'),
      timeoutMs: PROBE_TIMEOUT_MS,
      env: {
        ComSpec: 'C:\\Windows\\System32\\cmd.exe',
        SystemRoot: 'C:\\Windows',
        PATH: SYSTEM32,
      },
    },
  );
  if (
    result.code !== 0 ||
    result.signal !== null ||
    result.stderr.length !== 0
  ) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_PROBE_FAILED',
      'Native addon probe failed.',
    );
  }
  const response = decodeCanonicalJson(result.stdout, 4096);
  if (
    !exactKeys(response, ['status', 'result']) ||
    response.status !== 'probed' ||
    !exactKeys(response.result, EXPECTED_RESULT_KEYS) ||
    response.result.outcome !== 'ordinary' ||
    response.result.reparseTag !== 0 ||
    response.result.win32Error !== 0 ||
    response.result.closeWin32Error !== 0 ||
    (response.result.fileAttributes & 0x00000400) !== 0
  ) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_PROBE_FAILED',
      'Native addon probe returned invalid evidence.',
    );
  }
  return response;
}

function createReceipt(sourceEvidence, toolchain, artifactEvidence) {
  return {
    receiptFormat: RECEIPT_FORMAT,
    receiptVersion: 1,
    nativeContractVersion: 1,
    target: {
      platform: 'win32',
      architecture: 'x64',
      nodeVersion: 'v24.13.0',
      nodeApiVersion: 8,
    },
    source: {
      path: SOURCE_RELATIVE,
      byteLength: sourceEvidence.byteLength,
      sha256: sourceEvidence.sha256,
    },
    toolchain: {
      msvcVersion: MSVC_VERSION,
      compilerVersion: COMPILER_VERSION,
      linkerVersion: LINKER_VERSION,
      windowsSdkVersion: WINDOWS_SDK_VERSION,
      nodeHeadersTreeSha256: toolchain.nodeHeadersTreeSha256,
      nodeImportLibraryByteLength: toolchain.nodeImport.byteLength,
      nodeImportLibrarySha256: toolchain.nodeImport.sha256,
      kernel32ImportLibraryByteLength: toolchain.kernel32Import.byteLength,
      kernel32ImportLibrarySha256: toolchain.kernel32Import.sha256,
    },
    artifact: {
      path: ARTIFACT_RELATIVE,
      byteLength: artifactEvidence.byteLength,
      sha256: artifactEvidence.sha256,
    },
  };
}

function positiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validateReceipt(receipt) {
  if (
    !exactKeys(receipt, RECEIPT_KEYS) ||
    receipt.receiptFormat !== RECEIPT_FORMAT ||
    receipt.receiptVersion !== 1 ||
    receipt.nativeContractVersion !== 1 ||
    !exactKeys(receipt.target, [
      'platform',
      'architecture',
      'nodeVersion',
      'nodeApiVersion',
    ]) ||
    receipt.target.platform !== 'win32' ||
    receipt.target.architecture !== 'x64' ||
    receipt.target.nodeVersion !== 'v24.13.0' ||
    receipt.target.nodeApiVersion !== 8 ||
    !exactKeys(receipt.source, ['path', 'byteLength', 'sha256']) ||
    receipt.source.path !== SOURCE_RELATIVE ||
    !positiveSafeInteger(receipt.source.byteLength) ||
    !HEX_64.test(receipt.source.sha256) ||
    !exactKeys(receipt.toolchain, [
      'msvcVersion',
      'compilerVersion',
      'linkerVersion',
      'windowsSdkVersion',
      'nodeHeadersTreeSha256',
      'nodeImportLibraryByteLength',
      'nodeImportLibrarySha256',
      'kernel32ImportLibraryByteLength',
      'kernel32ImportLibrarySha256',
    ]) ||
    receipt.toolchain.msvcVersion !== MSVC_VERSION ||
    receipt.toolchain.compilerVersion !== COMPILER_VERSION ||
    receipt.toolchain.linkerVersion !== LINKER_VERSION ||
    receipt.toolchain.windowsSdkVersion !== WINDOWS_SDK_VERSION ||
    !HEX_64.test(receipt.toolchain.nodeHeadersTreeSha256) ||
    !positiveSafeInteger(receipt.toolchain.nodeImportLibraryByteLength) ||
    !HEX_64.test(receipt.toolchain.nodeImportLibrarySha256) ||
    !positiveSafeInteger(receipt.toolchain.kernel32ImportLibraryByteLength) ||
    !HEX_64.test(receipt.toolchain.kernel32ImportLibrarySha256) ||
    !exactKeys(receipt.artifact, ['path', 'byteLength', 'sha256']) ||
    receipt.artifact.path !== ARTIFACT_RELATIVE ||
    !positiveSafeInteger(receipt.artifact.byteLength) ||
    !HEX_64.test(receipt.artifact.sha256)
  ) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_RECEIPT_INVALID',
      'Canonical native build receipt is invalid.',
    );
  }
  return receipt;
}

function decodeReceiptBytes(bytes) {
  return validateReceipt(decodeCanonicalJson(bytes));
}

async function fileEvidence(target) {
  const metadata = await authenticatePath(target, 'file');
  const byteLength = Number(metadata.size);
  const bytes = await fsp.readFile(target);
  if (!positiveSafeInteger(byteLength) || byteLength !== bytes.length) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_EVIDENCE_INVALID',
      'Native build file evidence is invalid.',
    );
  }
  return Object.freeze({ byteLength, sha256: sha256(bytes) });
}

async function writeReceipt(paths, toolchain) {
  const sourceEvidence = await fileEvidence(paths.source);
  const artifactEvidence = await fileEvidence(paths.stagedAddon);
  const receipt = createReceipt(sourceEvidence, toolchain, artifactEvidence);
  validateReceipt(receipt);
  const bytes = Buffer.from(canonicalJson(receipt), 'utf8');
  decodeReceiptBytes(bytes);
  await fsp.writeFile(paths.stagedReceipt, bytes, { flag: 'wx' });
  const actual = await fsp.readFile(paths.stagedReceipt);
  if (!actual.equals(bytes)) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_RECEIPT_INVALID',
      'Canonical native build receipt verification failed.',
    );
  }
  return Object.freeze({ receipt, bytes, artifactEvidence });
}

async function verifyFinalReceiptAndArtifact(paths, expected) {
  await authenticatePath(paths.receipt, 'file');
  const receiptBytes = await fsp.readFile(paths.receipt);
  const receipt = decodeReceiptBytes(receiptBytes);
  if (!receiptBytes.equals(expected.bytes)) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_RECEIPT_INVALID',
      'Final native build receipt bytes changed.',
    );
  }
  await authenticatePath(paths.artifact, 'file');
  const artifact = await fileEvidence(paths.artifact);
  if (
    artifact.byteLength !== receipt.artifact.byteLength ||
    artifact.sha256 !== receipt.artifact.sha256 ||
    artifact.byteLength !== expected.artifactEvidence.byteLength ||
    artifact.sha256 !== expected.artifactEvidence.sha256
  ) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_RECEIPT_INVALID',
      'Final native artifact does not match its receipt.',
    );
  }
  return artifact;
}

async function promoteAndFinalize(context) {
  const { state, expected, hooks } = context;
  const paths = state.paths;
  await assertAbsent(paths.artifact, true);
  await assertAbsent(paths.receipt, true);
  if (hooks.beforeBinaryPromotion) await hooks.beforeBinaryPromotion();
  try {
    await fsp.link(paths.stagedAddon, paths.artifact);
  } catch {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_COLLISION',
      'Generated native output collided during no-replace promotion.',
    );
  }
  state.firstPromotionOccurred = true;
  await fsp.unlink(paths.stagedAddon);
  if (hooks.afterBinaryPromotion) await hooks.afterBinaryPromotion();
  try {
    await fsp.link(paths.stagedReceipt, paths.receipt);
  } catch {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_COLLISION',
      'Generated native output collided during no-replace promotion.',
    );
  }
  await fsp.unlink(paths.stagedReceipt);
  if (hooks.afterReceiptPromotion) await hooks.afterReceiptPromotion();

  await context.verifyFinalReceipt();
  if (hooks.afterFinalReceiptVerification) {
    await hooks.afterFinalReceiptVerification();
  }
  const artifact = await context.verifyFinalArtifact();
  if (hooks.afterFinalArtifactVerification) {
    await hooks.afterFinalArtifactVerification();
  }
  await context.probeFinal();
  if (hooks.afterFinalProbe) await hooks.afterFinalProbe();
  await removeAuthenticatedStaging(state);
  if (hooks.beforeLockRelease) await hooks.beforeLockRelease();
  await releaseOwnedLock(state);
  await state.lease.close();
  state.lease = null;
  return artifact;
}

async function handleBuildFailure(state, originalError) {
  let failure = originalError;
  if (!state.firstPromotionOccurred) {
    try {
      await removeAuthenticatedStaging(state);
      await releaseOwnedLock(state);
    } catch (cleanupError) {
      failure = cleanupError;
    }
  }
  if (state.lease !== null) {
    await state.lease.close().catch(() => {});
    state.lease = null;
  }
  throw failure;
}

async function runBuild() {
  const inputs = await authenticateBuildInputs();
  const stagingName = `${STAGING_PREFIX}${randomBytes(16).toString('hex')}`;
  const nonce = randomBytes(16).toString('hex');
  const paths = packagePaths(inputs.canonicalRoot, stagingName);
  if (
    !isStrictDescendant(inputs.canonicalRoot, paths.source) ||
    !isStrictDescendant(inputs.canonicalRoot, paths.release) ||
    !isStrictDescendant(paths.release, paths.staging) ||
    path.relative(inputs.canonicalRoot, paths.artifact).split(path.sep).join('/') !==
      ARTIFACT_RELATIVE ||
    path.relative(inputs.canonicalRoot, paths.receipt).split(path.sep).join('/') !==
      RECEIPT_RELATIVE ||
    path.relative(inputs.canonicalRoot, paths.lock).split(path.sep).join('/') !==
      LOCK_RELATIVE
  ) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_PATH_INVALID',
      'Exact package-relative native build paths did not authenticate.',
    );
  }
  await ensureOrdinaryDirectory(paths.build, inputs.canonicalRoot);
  await ensureOrdinaryDirectory(paths.release, paths.build);

  const state = {
    paths,
    lease: null,
    lockOwned: false,
    lockIdentity: null,
    stagingCreated: false,
    stagingIdentity: null,
    firstPromotionOccurred: false,
    allowedStagingNames: new Set(STAGING_FILE_NAMES),
  };
  try {
    state.lease = await startLease(inputs.pipeName);
    const lockRecord = createLockRecord(
      inputs.repositoryKey,
      inputs.pipeName,
      stagingName,
      nonce,
    );
    validateLockRecord(lockRecord, inputs.repositoryKey, inputs.pipeName);
    const lockBytes = Buffer.from(canonicalJson(lockRecord), 'utf8');
    decodeLockBytes(lockBytes, inputs.repositoryKey, inputs.pipeName);
    await acquireLock(paths.lock, lockBytes, state);
    await assertAbsent(paths.artifact, true);
    await assertAbsent(paths.receipt, true);

    const stagingMetadata = await ensureOrdinaryDirectory(
      paths.staging,
      paths.release,
    );
    state.stagingCreated = true;
    state.stagingIdentity = identityOf(stagingMetadata);
    await fsp.writeFile(paths.probeFile, 'moxley-native-build-probe\n', {
      encoding: 'utf8',
      flag: 'wx',
    });
    await compileProductionAddon(paths, inputs.toolchain);
    await authenticateStagingDirectory(state);
    await runProbe(paths.stagedAddon, paths.probeFile);
    const expected = await writeReceipt(paths, inputs.toolchain);
    await authenticateStagingDirectory(state);

    let finalArtifact;
    finalArtifact = await promoteAndFinalize({
      state,
      expected,
      hooks: Object.freeze({}),
      verifyFinalReceipt: async () => {
        await authenticatePath(paths.receipt, 'file');
        const bytes = await fsp.readFile(paths.receipt);
        decodeReceiptBytes(bytes);
        if (!bytes.equals(expected.bytes)) {
          throw buildError(
            'MOXLEY_NATIVE_BUILD_RECEIPT_INVALID',
            'Final native build receipt bytes changed.',
          );
        }
      },
      verifyFinalArtifact: () =>
        verifyFinalReceiptAndArtifact(paths, expected),
      probeFinal: () => runProbe(paths.artifact, paths.probeFile),
    });
    return {
      status: 'built',
      artifact: ARTIFACT_RELATIVE,
      receipt: RECEIPT_RELATIVE,
      artifactSha256: finalArtifact.sha256,
    };
  } catch (error) {
    return handleBuildFailure(state, error);
  }
}

async function exercisePromotionScenario(sandboxRoot, mode) {
  const tempRoot = await fsp.realpath(os.tmpdir());
  const canonicalSandbox = await fsp.realpath(sandboxRoot);
  if (
    path.dirname(canonicalSandbox).toLowerCase() !== tempRoot.toLowerCase() ||
    !path.basename(canonicalSandbox).startsWith('moxley-native-build-test-') ||
    !['success', 'pre', 'post'].includes(mode)
  ) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_TEST_SCOPE_INVALID',
      'Injected native build test scope is invalid.',
    );
  }
  const release = path.join(canonicalSandbox, 'Release');
  await fsp.mkdir(release, { recursive: false });
  const stagingName = `${STAGING_PREFIX}${'a'.repeat(32)}`;
  const paths = {
    release,
    staging: path.join(release, stagingName),
    stagedAddon: path.join(release, stagingName, 'moxley-windows-reparse.node'),
    stagedReceipt: path.join(
      release,
      stagingName,
      'moxley-windows-reparse.receipt.json',
    ),
    probeFile: path.join(
      release,
      stagingName,
      'moxley-windows-reparse-probe.txt',
    ),
    artifact: path.join(release, 'moxley-windows-reparse.node'),
    receipt: path.join(release, 'moxley-windows-reparse.receipt.json'),
    lock: path.join(release, '.moxley-windows-reparse-build.lock'),
  };
  await fsp.mkdir(paths.staging, { recursive: false });
  await fsp.writeFile(paths.stagedAddon, 'binary', { flag: 'wx' });
  await fsp.writeFile(paths.stagedReceipt, '{}\n', { flag: 'wx' });
  await fsp.writeFile(paths.probeFile, 'probe\n', { flag: 'wx' });
  await fsp.writeFile(paths.lock, 'owned-lock\n', { flag: 'wx' });
  const stageMetadata = await fsp.lstat(paths.staging, { bigint: true });
  const lockMetadata = await fsp.lstat(paths.lock, { bigint: true });
  const observations = {
    receiptVerificationLockHeld: false,
    artifactVerificationLockHeld: false,
    finalProbeLockHeld: false,
    stagingRemovedBeforeLock: false,
    leaseClosed: false,
  };
  const state = {
    paths,
    lease: {
      async close() {
        observations.leaseClosed = true;
      },
    },
    lockOwned: true,
    lockIdentity: identityOf(lockMetadata),
    stagingCreated: true,
    stagingIdentity: identityOf(stageMetadata),
    firstPromotionOccurred: false,
    allowedStagingNames: new Set([
      'moxley-windows-reparse.node',
      'moxley-windows-reparse.receipt.json',
      'moxley-windows-reparse-probe.txt',
    ]),
  };
  const hooks = {
    beforeBinaryPromotion:
      mode === 'pre'
        ? async () => {
            throw buildError(
              'MOXLEY_NATIVE_BUILD_INJECTED_FAILURE',
              'Injected pre-promotion failure.',
            );
          }
        : undefined,
    afterBinaryPromotion:
      mode === 'post'
        ? async () => {
            throw buildError(
              'MOXLEY_NATIVE_BUILD_INJECTED_FAILURE',
              'Injected post-promotion failure.',
            );
          }
        : undefined,
    beforeLockRelease: async () => {
      observations.stagingRemovedBeforeLock =
        !(await exists(paths.staging)) && (await exists(paths.lock));
    },
  };
  try {
    await promoteAndFinalize({
      state,
      expected: {},
      hooks,
      verifyFinalReceipt: async () => {
        observations.receiptVerificationLockHeld = await exists(paths.lock);
      },
      verifyFinalArtifact: async () => {
        observations.artifactVerificationLockHeld = await exists(paths.lock);
        return { byteLength: 6, sha256: sha256(Buffer.from('binary')) };
      },
      probeFinal: async () => {
        observations.finalProbeLockHeld = await exists(paths.lock);
      },
    });
    return { mode, paths, observations, failed: false };
  } catch (error) {
    try {
      await handleBuildFailure(state, error);
    } catch (handled) {
      return {
        mode,
        paths,
        observations,
        failed: true,
        code: handled.code,
      };
    }
  }
  throw buildError(
    'MOXLEY_NATIVE_BUILD_TEST_FAILED',
    'Injected native build scenario did not terminate.',
  );
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

async function repositoryLeaseIdentity() {
  const canonicalRoot = await fsp.realpath(PACKAGE_ROOT);
  const key = repositoryKey(canonicalRoot);
  return Object.freeze({
    canonicalRoot,
    repositoryKey: key,
    pipeName: pipeNameForKey(key),
    paths: packagePaths(canonicalRoot, `${STAGING_PREFIX}${'a'.repeat(32)}`),
  });
}

function formatDiagnostic(error) {
  const code =
    error instanceof NativeBuildError && typeof error.code === 'string'
      ? error.code
      : 'MOXLEY_NATIVE_BUILD_FAILED';
  const message =
    error instanceof NativeBuildError && typeof error.message === 'string'
      ? error.message
      : 'Native build failed.';
  return `${code}: ${message}`
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 240);
}

const internal = Object.freeze({
  ARTIFACT_RELATIVE,
  LOCK_RELATIVE,
  PACKAGE_ROOT,
  RECEIPT_RELATIVE,
  STAGING_FILE_NAMES,
  STAGING_PREFIX,
  assertAbsent,
  assertNoReparse,
  authenticatePath,
  canonicalJson,
  createLockRecord,
  decodeCanonicalJson,
  decodeLockBytes,
  exists,
  exactKeys,
  formatDiagnostic,
  identityOf,
  inventoryStagingTree,
  isStrictDescendant,
  ordinalCompare,
  packagePaths,
  pipeNameForKey,
  repositoryKey,
  sameIdentity,
  sameWindowsPath,
  sha256,
  validateLockRecord,
});

module.exports = Object.freeze({
  internal,
  __test: Object.freeze({
    authenticateBuildInputs,
    createReceipt,
    decodeReceiptBytes,
    exercisePromotionScenario,
    repositoryLeaseIdentity,
    runBuild,
    validateReceipt,
  }),
});

if (require.main === module) {
  if (process.argv.length !== 2) {
    process.stderr.write(
      'MOXLEY_NATIVE_BUILD_ARGUMENT_INVALID: Native build accepts no arguments.\n',
    );
    process.exitCode = 1;
  } else {
    runBuild()
      .then((result) => {
        process.stdout.write(canonicalJson(result));
      })
      .catch((error) => {
        process.stderr.write(`${formatDiagnostic(error)}\n`);
        process.exitCode = 1;
      });
  }
}
