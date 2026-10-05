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
const DISPOSITION_RELATIVE =
  'build/Release/.moxley-windows-reparse-build.disposition.json';
const STAGING_PREFIX = '.moxley-windows-reparse-stage-';
const LOCK_FORMAT = 'moxley-native-build-lock';
const DISPOSITION_FORMAT = 'moxley-native-build-disposition';
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
const WINDOWS_ROOT = 'C:\\Windows';
const SYSTEM32 = 'C:\\Windows\\System32';
const TASKKILL_EXE = 'C:\\Windows\\System32\\taskkill.exe';
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
const AUTHENTICATION_TIMEOUT_MS = 90_000;
const PROBE_TIMEOUT_MS = 10_000;
const LEASE_CLOSE_TIMEOUT_MS = 5_000;
const EXIT_CLOSE_GRACE_MS = 5_000;
const TASKKILL_TIMEOUT_MS = 10_000;
const POST_TERMINATION_GRACE_MS = 5_000;
const EXPECTED_HOST = Object.freeze({
  caption: 'Microsoft Windows 11 Home',
  displayVersion: '25H2',
  build: '26200.9457',
  driveType: 'Fixed',
  driveFormat: 'NTFS',
});
const MAX_PROCESS_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_JSON_BYTES = 16 * 1024;
const MAX_CARRIER_BYTES = 2048;
const SUBPROCESS_MESSAGES = Object.freeze({
  MOXLEY_NATIVE_BUILD_SUBPROCESS_SPAWN_FAILED:
    'Native build subprocess could not be spawned.',
  MOXLEY_NATIVE_BUILD_SUBPROCESS_TIMED_OUT:
    'Native build subprocess exceeded its execution bound.',
  MOXLEY_NATIVE_BUILD_SUBPROCESS_OUTPUT_LIMIT:
    'Native build subprocess exceeded its output bound.',
  MOXLEY_NATIVE_BUILD_SUBPROCESS_EXIT_FAILED:
    'Native build subprocess did not exit successfully.',
  MOXLEY_NATIVE_BUILD_SUBPROCESS_TERMINATION_UNCONFIRMED:
    'Native build subprocess termination could not be confirmed.',
});
const SUBPROCESS_REASONS = Object.freeze({
  SPAWN_ERROR: 'SUBPROCESS_SPAWN_ERROR',
  TIMEOUT: 'SUBPROCESS_TIMEOUT',
  STDOUT_LIMIT: 'SUBPROCESS_STDOUT_LIMIT',
  STDERR_LIMIT: 'SUBPROCESS_STDERR_LIMIT',
  NONZERO_EXIT: 'SUBPROCESS_NONZERO_EXIT',
  SIGNALLED_EXIT: 'SUBPROCESS_SIGNALLED_EXIT',
  EXIT_WITHOUT_CLOSE: 'SUBPROCESS_EXIT_WITHOUT_CLOSE',
  TERMINATION_TOOL_FAILED: 'SUBPROCESS_TERMINATION_TOOL_FAILED',
  TERMINATION_NOT_CONFIRMED: 'SUBPROCESS_TERMINATION_NOT_CONFIRMED',
});
const TEST_CONTROL_TOKEN = Symbol('moxley-native-subprocess-test-control');
const CARRIER_TEST_CONTROL_TOKEN = Symbol('moxley-native-carrier-test-control');
const TERMINAL_CARRIER_TEST_CONTROL = Symbol(
  'moxley-native-terminal-carrier-test-control',
);
const DIAGNOSTIC_CONTROL_TOKEN = Symbol(
  'moxley-native-d1-diagnostic-control',
);
const RETENTION_PLAN_TEST_ERROR = Symbol('moxley-native-retention-plan-test-error');
const STAGING_AUTH_TEST_ERROR = Symbol('moxley-native-staging-auth-test-error');
const DIAGNOSTIC_CONTROL_STATES = new WeakMap();
const SUPERVISOR_FAILURE_SNAPSHOTS = new WeakMap();
const HEX_32 = /^[0-9a-f]{32}$/;
const HEX_64 = /^[0-9a-f]{64}$/;
const MAX_DIAGNOSTIC_RECORD_BYTES = 1024;
const MAX_DIAGNOSTIC_RECORDS = 128;
const MAX_DIAGNOSTIC_OUTPUT_BYTES = 128 * 1024;
const MAX_ACTIVE_TYPES = 16;
const MAX_ACTIVE_OBJECTS = 64;
const DIAGNOSTIC_RECORD_KEYS = Object.freeze([
  'format',
  'version',
  'runId',
  'sequence',
  'phase',
  'elapsedMs',
  'detail',
]);
const DIAGNOSTIC_PHASES = Object.freeze([
  'RECEIPT_DONE',
  'STAGING_AUTH_2_BEGIN',
  'STAGING_ROOT_BEGIN',
  'STAGING_ROOT_DONE',
  'STAGING_READDIR_DONE',
  'STAGING_ENTRY_BEGIN',
  'STAGING_ENTRY_DONE',
  'STAGING_AUTH_2_DONE',
  'RECEIPT_VALIDATED',
  'DEFERRAL_CALLED',
  'DEFERRAL_ARTIFACT_ABSENT',
  'DEFERRAL_RECEIPT_ABSENT',
  'DEFERRAL_THROW',
  'RUNBUILD_CATCH_ENTERED',
  'RETENTION_BEGIN',
  'RETENTION_STAGING_DONE',
  'LOCK_AUTH_DONE',
  'LOCK_READBACK_DONE',
  'RETENTION_DISPOSITION_ABSENT',
  'RETENTION_ARTIFACT_ABSENT',
  'RETENTION_RECEIPT_ABSENT',
  'RETENTION_PREPARED',
  'DISPOSITION_BEGIN',
  'DISPOSITION_CREATE_DONE',
  'DISPOSITION_WRITE_DONE',
  'DISPOSITION_SYNC_DONE',
  'DISPOSITION_CLOSE_DONE',
  'DISPOSITION_AUTHENTICATE_DONE',
  'DISPOSITION_READBACK_DONE',
  'DISPOSITION_ACKNOWLEDGED',
  'LEASE_CLOSE_BEGIN',
  'LEASE_CLOSE_DONE',
  'LEASE_CLOSE_REJECTED',
  'LEASE_CLOSE_TIMEOUT',
  'LEASE_ABANDON_CALLED',
  'ORIGINAL_ERROR_RETHROWN',
  'RUNBUILD_SETTLED_FULFILLED',
  'RUNBUILD_SETTLED_REJECTED',
  'POST_SETTLEMENT_HANDLES',
  'EXIT_CODE_SET',
]);
const SUPERVISOR_SNAPSHOT_KEYS = Object.freeze([
  'stdout',
  'stderr',
  'exitCode',
  'signal',
  'stdoutOverflowed',
  'stderrOverflowed',
  'stdoutCompleted',
  'stderrCompleted',
  'exitObserved',
  'closeObserved',
  'terminationConfirmed',
  'captureComplete',
]);
const LOCK_V2_KEYS = Object.freeze([
  'lockFormat',
  'lockVersion',
  'repositoryKey',
  'pipeName',
  'stagingName',
  'nonce',
  'disposition',
]);
const DISPOSITION_KEYS = Object.freeze([
  'dispositionFormat',
  'dispositionVersion',
  'lockVersion',
  'repositoryKey',
  'pipeName',
  'stagingName',
  'nonce',
  'disposition',
  'reason',
  'causeReason',
]);
const TERMINATION_DISPOSITION_REASONS = Object.freeze([
  'SUBPROCESS_TERMINATION_TOOL_FAILED',
  'SUBPROCESS_TERMINATION_NOT_CONFIRMED',
]);
const TERMINATION_DISPOSITION_CAUSES = Object.freeze([
  null,
  'SUBPROCESS_TIMEOUT',
  'SUBPROCESS_STDOUT_LIMIT',
  'SUBPROCESS_STDERR_LIMIT',
  'SUBPROCESS_EXIT_WITHOUT_CLOSE',
]);
const CARRIER_FAULTS = Object.freeze([
  'none',
  'create',
  'write-zero',
  'write-partial',
  'sync',
  'close',
  'authentication',
  'readback',
]);
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

function physicalCleanupDeferredError() {
  return buildError(
    'MOXLEY_NATIVE_BUILD_PHYSICAL_CLEANUP_DEFERRED',
    'Secure physical cleanup is unavailable; native build state was retained.',
  );
}

function leaseCloseTimedOutError() {
  return buildError(
    'MOXLEY_NATIVE_BUILD_LEASE_CLOSE_TIMED_OUT',
    'Native build lease close timed out.',
  );
}

function subprocessBuildError(
  code,
  reason,
  terminationConfirmed,
  originalReason,
) {
  const message = SUBPROCESS_MESSAGES[code];
  const acceptedReasons = Object.values(SUBPROCESS_REASONS);
  if (
    typeof message !== 'string' ||
    !acceptedReasons.includes(reason) ||
    typeof terminationConfirmed !== 'boolean' ||
    (originalReason !== undefined && !acceptedReasons.includes(originalReason))
  ) {
    return buildError(
      'MOXLEY_NATIVE_BUILD_FAILED',
      'Native build failed.',
    );
  }
  const error = buildError(code, message);
  error.stack = `${error.name}: ${message}`;
  error.reason = reason;
  error.terminationConfirmed = terminationConfirmed;
  if (originalReason !== undefined) {
    error.cause = Object.freeze({ reason: originalReason });
  }
  return error;
}

function terminationUnconfirmedError(reason, originalReason) {
  return subprocessBuildError(
    'MOXLEY_NATIVE_BUILD_SUBPROCESS_TERMINATION_UNCONFIRMED',
    reason,
    false,
    originalReason,
  );
}

function isTerminationUnconfirmed(error) {
  return (
    error instanceof NativeBuildError &&
    error.code ===
      'MOXLEY_NATIVE_BUILD_SUBPROCESS_TERMINATION_UNCONFIRMED' &&
    error.terminationConfirmed === false
  );
}

function isSubprocessBuildError(error) {
  return (
    error instanceof NativeBuildError &&
    typeof SUBPROCESS_MESSAGES[error.code] === 'string' &&
    Object.values(SUBPROCESS_REASONS).includes(error.reason)
  );
}

let cachedTaskkillAuthentication = null;

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

function diagnosticEvidenceError() {
  return buildError(
    'MOXLEY_NATIVE_BUILD_DIAGNOSTIC_EVIDENCE_INVALID',
    'Private native build diagnostic evidence is invalid.',
  );
}

function validateActiveSummary(summary) {
  if (!Array.isArray(summary) || summary.length > MAX_ACTIVE_TYPES) {
    throw diagnosticEvidenceError();
  }
  const accepted = [];
  let total = 0;
  let previous = null;
  for (const entry of summary) {
    if (
      !exactKeys(entry, ['type', 'count']) ||
      typeof entry.type !== 'string' ||
      !/^[A-Za-z][A-Za-z0-9]{0,31}$/.test(entry.type) ||
      !Number.isSafeInteger(entry.count) ||
      entry.count <= 0 ||
      (previous !== null && ordinalCompare(previous, entry.type) >= 0)
    ) {
      throw diagnosticEvidenceError();
    }
    total += entry.count;
    if (total > MAX_ACTIVE_OBJECTS) throw diagnosticEvidenceError();
    accepted.push(Object.freeze({ type: entry.type, count: entry.count }));
    previous = entry.type;
  }
  return Object.freeze(accepted);
}

function sanitizedActiveType(value) {
  if (
    value === null ||
    (typeof value !== 'object' && typeof value !== 'function')
  ) {
    throw diagnosticEvidenceError();
  }
  let prototype = Object.getPrototypeOf(value);
  let constructorValue = null;
  while (prototype !== null && constructorValue === null) {
    const descriptor = Object.getOwnPropertyDescriptor(
      prototype,
      'constructor',
    );
    if (descriptor !== undefined) {
      if (
        !Object.hasOwn(descriptor, 'value') ||
        typeof descriptor.value !== 'function'
      ) {
        throw diagnosticEvidenceError();
      }
      constructorValue = descriptor.value;
      break;
    }
    prototype = Object.getPrototypeOf(prototype);
  }
  if (constructorValue === null) throw diagnosticEvidenceError();
  const nameDescriptor = Object.getOwnPropertyDescriptor(
    constructorValue,
    'name',
  );
  const type = nameDescriptor?.value;
  if (
    typeof type !== 'string' ||
    !/^[A-Za-z][A-Za-z0-9]{0,31}$/.test(type)
  ) {
    throw diagnosticEvidenceError();
  }
  return type;
}

function sanitizeActiveObjects(objects) {
  if (!Array.isArray(objects) || objects.length > MAX_ACTIVE_OBJECTS) {
    throw diagnosticEvidenceError();
  }
  const counts = new Map();
  for (const object of objects) {
    const type = sanitizedActiveType(object);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  if (counts.size > MAX_ACTIVE_TYPES) throw diagnosticEvidenceError();
  return validateActiveSummary(
    [...counts.entries()]
      .sort(([left], [right]) => ordinalCompare(left, right))
      .map(([type, count]) => ({ type, count })),
  );
}

function createActiveDeltaEvidence(baseline, after) {
  const acceptedBaseline = validateActiveSummary(baseline);
  const acceptedAfter = validateActiveSummary(after);
  const baselineCounts = new Map(
    acceptedBaseline.map((entry) => [entry.type, entry.count]),
  );
  const delta = [];
  for (const entry of acceptedAfter) {
    const count = entry.count - (baselineCounts.get(entry.type) ?? 0);
    if (count > 0) delta.push({ type: entry.type, count });
  }
  return Object.freeze({
    baseline: acceptedBaseline,
    after: acceptedAfter,
    delta: validateActiveSummary(delta),
    overflow: false,
  });
}

function validateActiveDeltaEvidence(value) {
  if (
    !exactKeys(value, ['baseline', 'after', 'delta', 'overflow']) ||
    value.overflow !== false
  ) {
    throw diagnosticEvidenceError();
  }
  const accepted = createActiveDeltaEvidence(value.baseline, value.after);
  if (JSON.stringify(accepted) !== JSON.stringify(value)) {
    throw diagnosticEvidenceError();
  }
  return accepted;
}

function captureActiveEvidence() {
  if (typeof process._getActiveHandles !== 'function') {
    throw diagnosticEvidenceError();
  }
  const handles = sanitizeActiveObjects(process._getActiveHandles());
  const requests = sanitizeActiveObjects(
    typeof process._getActiveRequests === 'function'
      ? process._getActiveRequests()
      : [],
  );
  return Object.freeze({ handles, requests });
}

function compareActiveEvidence(baseline, after) {
  if (
    !exactKeys(baseline, ['handles', 'requests']) ||
    !exactKeys(after, ['handles', 'requests'])
  ) {
    throw diagnosticEvidenceError();
  }
  return Object.freeze({
    handles: createActiveDeltaEvidence(baseline.handles, after.handles),
    requests: createActiveDeltaEvidence(
      baseline.requests,
      after.requests,
    ),
  });
}

function validateDiagnosticDetail(phase, detail) {
  if (phase === 'STAGING_READDIR_DONE') {
    if (
      !exactKeys(detail, ['entryCount']) ||
      !Number.isSafeInteger(detail.entryCount) ||
      detail.entryCount < 0 ||
      detail.entryCount > MAX_ACTIVE_OBJECTS
    ) {
      throw diagnosticEvidenceError();
    }
    return Object.freeze({ entryCount: detail.entryCount });
  }
  if (phase === 'STAGING_ENTRY_BEGIN' || phase === 'STAGING_ENTRY_DONE') {
    if (
      !exactKeys(detail, ['kind', 'ordinal']) ||
      !['file', 'directory'].includes(detail.kind) ||
      !Number.isSafeInteger(detail.ordinal) ||
      detail.ordinal < 0 ||
      detail.ordinal >= MAX_ACTIVE_OBJECTS
    ) {
      throw diagnosticEvidenceError();
    }
    return Object.freeze({ kind: detail.kind, ordinal: detail.ordinal });
  }
  if (phase === 'RUNBUILD_SETTLED_REJECTED') {
    if (
      !exactKeys(detail, ['code']) ||
      typeof detail.code !== 'string' ||
      !/^MOXLEY_[A-Z0-9_]{1,95}$/.test(detail.code)
    ) {
      throw diagnosticEvidenceError();
    }
    return Object.freeze({ code: detail.code });
  }
  if (phase === 'POST_SETTLEMENT_HANDLES') {
    if (!exactKeys(detail, ['handles', 'requests'])) {
      throw diagnosticEvidenceError();
    }
    return Object.freeze({
      handles: validateActiveDeltaEvidence(detail.handles),
      requests: validateActiveDeltaEvidence(detail.requests),
    });
  }
  if (phase === 'EXIT_CODE_SET') {
    if (!exactKeys(detail, ['value']) || detail.value !== 1) {
      throw diagnosticEvidenceError();
    }
    return Object.freeze({ value: 1 });
  }
  if (detail !== null) throw diagnosticEvidenceError();
  return null;
}

function validateDiagnosticRecord(record, runId, sequence) {
  if (
    !exactKeys(record, DIAGNOSTIC_RECORD_KEYS) ||
    record.format !== 'moxley-d1-phase' ||
    record.version !== 1 ||
    record.runId !== runId ||
    !HEX_32.test(record.runId) ||
    record.sequence !== sequence ||
    !Number.isSafeInteger(record.sequence) ||
    record.sequence < 0 ||
    !DIAGNOSTIC_PHASES.includes(record.phase) ||
    !Number.isSafeInteger(record.elapsedMs) ||
    record.elapsedMs < 0
  ) {
    throw diagnosticEvidenceError();
  }
  validateDiagnosticDetail(record.phase, record.detail);
  return record;
}

function createDiagnosticControl(runId, writer = null) {
  if (
    typeof runId !== 'string' ||
    !HEX_32.test(runId) ||
    (writer !== null && typeof writer !== 'function')
  ) {
    throw diagnosticEvidenceError();
  }
  const control = Object.freeze({
    token: DIAGNOSTIC_CONTROL_TOKEN,
    runId,
  });
  DIAGNOSTIC_CONTROL_STATES.set(control, {
    runId,
    sequence: 0,
    byteLength: 0,
    started: process.hrtime.bigint(),
    writer:
      writer ??
      ((bytes) => fs.writeSync(process.stdout.fd, bytes)),
  });
  return control;
}

function diagnosticControlState(control, allowNull = false) {
  if (control === null && allowNull) return null;
  const state =
    control !== null && typeof control === 'object'
      ? DIAGNOSTIC_CONTROL_STATES.get(control)
      : undefined;
  if (
    state === undefined ||
    control.token !== DIAGNOSTIC_CONTROL_TOKEN ||
    control.runId !== state.runId ||
    !exactKeys(control, ['token', 'runId']) ||
    !Object.isFrozen(control)
  ) {
    throw diagnosticEvidenceError();
  }
  return state;
}

function emitDiagnosticPhase(control, phase, detail = null) {
  if (control === null) return null;
  const state = diagnosticControlState(control);
  if (
    state.sequence >= MAX_DIAGNOSTIC_RECORDS ||
    !DIAGNOSTIC_PHASES.includes(phase)
  ) {
    throw diagnosticEvidenceError();
  }
  const elapsedNs = process.hrtime.bigint() - state.started;
  const elapsedMs = Number(elapsedNs / 1_000_000n);
  const record = {
    format: 'moxley-d1-phase',
    version: 1,
    runId: state.runId,
    sequence: state.sequence,
    phase,
    elapsedMs,
    detail: validateDiagnosticDetail(phase, detail),
  };
  validateDiagnosticRecord(record, state.runId, state.sequence);
  const bytes = Buffer.from(canonicalJson(record), 'utf8');
  if (
    bytes.includes(13) ||
    bytes.length > MAX_DIAGNOSTIC_RECORD_BYTES ||
    state.byteLength + bytes.length > MAX_DIAGNOSTIC_OUTPUT_BYTES
  ) {
    throw diagnosticEvidenceError();
  }
  let written;
  try {
    written = state.writer(bytes);
  } catch {
    throw diagnosticEvidenceError();
  }
  if (written !== bytes.length) throw diagnosticEvidenceError();
  state.sequence += 1;
  state.byteLength += bytes.length;
  return Object.freeze({ ...record });
}

function parseDiagnosticPhaseStream(bytes, runId) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length === 0 ||
    bytes.length > MAX_DIAGNOSTIC_OUTPUT_BYTES ||
    typeof runId !== 'string' ||
    !HEX_32.test(runId) ||
    bytes.includes(13) ||
    bytes[bytes.length - 1] !== 10
  ) {
    throw diagnosticEvidenceError();
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw diagnosticEvidenceError();
  }
  const lines = text.slice(0, -1).split('\n');
  if (
    lines.length === 0 ||
    lines.length > MAX_DIAGNOSTIC_RECORDS ||
    lines.some((line) => line.length === 0)
  ) {
    throw diagnosticEvidenceError();
  }
  const records = [];
  for (let sequence = 0; sequence < lines.length; sequence += 1) {
    const lineBytes = Buffer.byteLength(`${lines[sequence]}\n`, 'utf8');
    if (lineBytes > MAX_DIAGNOSTIC_RECORD_BYTES) {
      throw diagnosticEvidenceError();
    }
    let record;
    try {
      record = JSON.parse(lines[sequence]);
    } catch {
      throw diagnosticEvidenceError();
    }
    validateDiagnosticRecord(record, runId, sequence);
    if (canonicalJson(record) !== `${lines[sequence]}\n`) {
      throw diagnosticEvidenceError();
    }
    records.push(Object.freeze(record));
  }
  return Object.freeze(records);
}

function validateSupervisorFailureSnapshot(snapshot) {
  if (
    !exactKeys(snapshot, SUPERVISOR_SNAPSHOT_KEYS) ||
    !Buffer.isBuffer(snapshot.stdout) ||
    !Buffer.isBuffer(snapshot.stderr) ||
    snapshot.stdout.length > MAX_PROCESS_OUTPUT_BYTES ||
    snapshot.stderr.length > MAX_PROCESS_OUTPUT_BYTES ||
    !(
      snapshot.exitCode === null ||
      Number.isSafeInteger(snapshot.exitCode)
    ) ||
    !(
      snapshot.signal === null ||
      (typeof snapshot.signal === 'string' &&
        /^[A-Z][A-Z0-9]{0,31}$/.test(snapshot.signal))
    ) ||
    ![
      'stdoutOverflowed',
      'stderrOverflowed',
      'stdoutCompleted',
      'stderrCompleted',
      'exitObserved',
      'closeObserved',
      'terminationConfirmed',
      'captureComplete',
    ].every((key) => typeof snapshot[key] === 'boolean') ||
    snapshot.captureComplete !==
      (snapshot.stdoutCompleted &&
        snapshot.stderrCompleted &&
        snapshot.closeObserved)
  ) {
    throw diagnosticEvidenceError();
  }
  return Object.freeze({
    stdout: Buffer.from(snapshot.stdout),
    stderr: Buffer.from(snapshot.stderr),
    exitCode: snapshot.exitCode,
    signal: snapshot.signal,
    stdoutOverflowed: snapshot.stdoutOverflowed,
    stderrOverflowed: snapshot.stderrOverflowed,
    stdoutCompleted: snapshot.stdoutCompleted,
    stderrCompleted: snapshot.stderrCompleted,
    exitObserved: snapshot.exitObserved,
    closeObserved: snapshot.closeObserved,
    terminationConfirmed: snapshot.terminationConfirmed,
    captureComplete: snapshot.captureComplete,
  });
}

function supervisorFailureSnapshot(error) {
  if (
    error === null ||
    (typeof error !== 'object' && typeof error !== 'function') ||
    !SUPERVISOR_FAILURE_SNAPSHOTS.has(error)
  ) {
    throw diagnosticEvidenceError();
  }
  return validateSupervisorFailureSnapshot(
    SUPERVISOR_FAILURE_SNAPSHOTS.get(error),
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

function boundedTimeout(value, fallback) {
  const selected = value === undefined ? fallback : value;
  if (
    !Number.isSafeInteger(selected) ||
    selected <= 0 ||
    selected > 300_000
  ) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_INPUT_INVALID',
      'Native build subprocess bounds are invalid.',
    );
  }
  return selected;
}

function isCanonicalTaskOwnedPid(child, pid) {
  return (
    child !== null &&
    child.pid === pid &&
    Number.isSafeInteger(pid) &&
    pid > 0 &&
    pid <= 0xffffffff &&
    pid !== process.pid &&
    pid !== process.ppid &&
    /^[1-9][0-9]*$/.test(String(pid))
  );
}

async function runTaskkill(
  supervisedChild,
  pid,
  childHasExited,
  onTerminationAttempt,
) {
  try {
    await authenticateTerminationExecutable();
  } catch {
    return 'failed';
  }
  if (childHasExited()) return 'not-dispatched';
  if (!isCanonicalTaskOwnedPid(supervisedChild, pid)) return 'failed';

  return new Promise((resolve) => {
    let taskkill = null;
    let stdout = null;
    let stderr = null;
    let timer = null;
    let settled = false;
    let spawnObserved = false;
    let exitObserved = false;
    let closeObserved = false;
    let stdoutCompleted = false;
    let stderrCompleted = false;
    let exitCode = null;
    let exitSignal = null;
    let stdoutLength = 0;
    let stderrLength = 0;

    function removeListeners() {
      if (taskkill !== null) {
        taskkill.removeListener('spawn', onSpawn);
        taskkill.removeListener('error', onError);
        taskkill.removeListener('exit', onExit);
        taskkill.removeListener('close', onClose);
      }
      if (stdout !== null) {
        stdout.removeListener('data', onStdoutData);
        stdout.removeListener('end', onStdoutEnd);
        stdout.removeListener('error', onStreamError);
      }
      if (stderr !== null) {
        stderr.removeListener('data', onStderrData);
        stderr.removeListener('end', onStderrEnd);
        stderr.removeListener('error', onStreamError);
      }
    }

    function finish(status, stopWrapper = false) {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (stopWrapper && taskkill !== null && !exitObserved) {
        try {
          taskkill.kill();
        } catch {
          // A failed direct signal does not broaden termination evidence.
        }
      }
      removeListeners();
      if (stopWrapper) {
        if (stdout !== null) stdout.destroy();
        if (stderr !== null) stderr.destroy();
        if (taskkill !== null) taskkill.unref();
      }
      taskkill = null;
      stdout = null;
      stderr = null;
      resolve(status);
    }

    function maybeFinish() {
      if (
        !settled &&
        spawnObserved &&
        exitObserved &&
        closeObserved &&
        stdoutCompleted &&
        stderrCompleted
      ) {
        finish(exitCode === 0 && exitSignal === null ? 'succeeded' : 'failed');
      }
    }

    function onSpawn() {
      spawnObserved = true;
      if (onTerminationAttempt !== null) {
        try {
          onTerminationAttempt(
            Object.freeze({
              authenticatedExecutable: true,
              canonicalPid: true,
              tree: true,
              force: true,
            }),
          );
        } catch {
          // Test-only observation cannot affect subprocess disposition.
        }
      }
    }

    function onError() {
      finish('failed', true);
    }

    function onExit(code, signal) {
      exitObserved = true;
      exitCode = code;
      exitSignal = signal;
      maybeFinish();
    }

    function onClose() {
      closeObserved = true;
      maybeFinish();
    }

    function onStdoutData(chunk) {
      stdoutLength += chunk.length;
      if (stdoutLength > MAX_PROCESS_OUTPUT_BYTES) finish('failed', true);
    }

    function onStderrData(chunk) {
      stderrLength += chunk.length;
      if (stderrLength > MAX_PROCESS_OUTPUT_BYTES) finish('failed', true);
    }

    function onStdoutEnd() {
      stdoutCompleted = true;
      maybeFinish();
    }

    function onStderrEnd() {
      stderrCompleted = true;
      maybeFinish();
    }

    function onStreamError() {
      finish('failed', true);
    }

    timer = setTimeout(() => finish('failed', true), TASKKILL_TIMEOUT_MS);
    try {
      taskkill = spawn(
        TASKKILL_EXE,
        ['/PID', String(pid), '/T', '/F'],
        {
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        },
      );
    } catch {
      finish('failed');
      return;
    }
    stdout = taskkill.stdout;
    stderr = taskkill.stderr;
    taskkill.once('spawn', onSpawn);
    taskkill.once('error', onError);
    taskkill.once('exit', onExit);
    taskkill.once('close', onClose);
    stdout.on('data', onStdoutData);
    stdout.once('end', onStdoutEnd);
    stdout.once('error', onStreamError);
    stderr.on('data', onStderrData);
    stderr.once('end', onStderrEnd);
    stderr.once('error', onStreamError);
  });
}

async function runProcess(file, arguments_, options = {}, testControl = null) {
  await authenticateTerminationExecutable();
  const timeoutMs = boundedTimeout(options.timeoutMs, PROCESS_TIMEOUT_MS);
  const acceptedTestControl =
    testControl !== null && testControl.token === TEST_CONTROL_TOKEN
      ? testControl
      : null;
  const exitCloseGraceMs =
    acceptedTestControl === null
      ? EXIT_CLOSE_GRACE_MS
      : acceptedTestControl.exitCloseGraceMs;
  const postTerminationGraceMs =
    acceptedTestControl === null
      ? POST_TERMINATION_GRACE_MS
      : acceptedTestControl.postTerminationGraceMs;
  const retainFailureOutput =
    acceptedTestControl !== null &&
    acceptedTestControl.retainFailureOutput === true;

  return new Promise((resolve, reject) => {
    let child = null;
    let stdin = null;
    let stdout = null;
    let stderr = null;
    let stdoutChunks = [];
    let stderrChunks = [];
    let stdoutLength = 0;
    let stderrLength = 0;
    let executionTimer = null;
    let exitCloseTimer = null;
    let postTerminationTimer = null;
    let settled = false;
    let spawnObserved = false;
    let exitObserved = false;
    let closeObserved = false;
    let stdoutCompleted = false;
    let stderrCompleted = false;
    let stdoutOverflowed = false;
    let stderrOverflowed = false;
    let acceptingOutput = true;
    let exitCode = null;
    let exitSignal = null;
    let terminalTrigger = null;
    let terminationStarted = false;
    let terminationConfirmationReady = false;
    let terminationOriginalReason = null;
    let terminationObserver =
      acceptedTestControl === null
        ? null
        : acceptedTestControl.onTerminationAttempt;

    function clearTimers() {
      if (executionTimer !== null) clearTimeout(executionTimer);
      if (exitCloseTimer !== null) clearTimeout(exitCloseTimer);
      if (postTerminationTimer !== null) clearTimeout(postTerminationTimer);
      executionTimer = null;
      exitCloseTimer = null;
      postTerminationTimer = null;
    }

    function removeListeners() {
      if (child !== null) {
        child.removeListener('spawn', onSpawn);
        child.removeListener('error', onChildError);
        child.removeListener('exit', onExit);
        child.removeListener('close', onClose);
      }
      if (stdin !== null) stdin.removeListener('error', onStdinError);
      if (stdout !== null) {
        stdout.removeListener('data', onStdoutData);
        stdout.removeListener('end', onStdoutEnd);
        stdout.removeListener('error', onStdoutError);
      }
      if (stderr !== null) {
        stderr.removeListener('data', onStderrData);
        stderr.removeListener('end', onStderrEnd);
        stderr.removeListener('error', onStderrError);
      }
    }

    function releaseReferences(releaseOpenHandles) {
      removeListeners();
      if (releaseOpenHandles) {
        if (stdin !== null) stdin.destroy();
        if (stdout !== null) stdout.destroy();
        if (stderr !== null) stderr.destroy();
        if (child !== null) child.unref();
      }
      child = null;
      stdin = null;
      stdout = null;
      stderr = null;
      stdoutChunks.length = 0;
      stderrChunks.length = 0;
      stdoutChunks = null;
      stderrChunks = null;
      terminationObserver = null;
    }

    function settleError(error) {
      if (settled) return;
      settled = true;
      clearTimers();
      if (retainFailureOutput) {
        try {
          const snapshot = validateSupervisorFailureSnapshot({
            stdout: Buffer.concat(stdoutChunks, stdoutLength),
            stderr: Buffer.concat(stderrChunks, stderrLength),
            exitCode,
            signal: exitSignal,
            stdoutOverflowed,
            stderrOverflowed,
            stdoutCompleted,
            stderrCompleted,
            exitObserved,
            closeObserved,
            terminationConfirmed: error?.terminationConfirmed === true,
            captureComplete:
              stdoutCompleted && stderrCompleted && closeObserved,
          });
          SUPERVISOR_FAILURE_SNAPSHOTS.set(error, snapshot);
        } catch {
          error = diagnosticEvidenceError();
        }
      }
      releaseReferences(!closeObserved);
      reject(error);
    }

    function settleResult() {
      if (settled) return;
      const result = Object.freeze({
        code: exitCode,
        signal: exitSignal,
        stdout: Buffer.concat(stdoutChunks, stdoutLength),
        stderr: Buffer.concat(stderrChunks, stderrLength),
      });
      settled = true;
      clearTimers();
      releaseReferences(false);
      resolve(result);
    }

    function selectTerminalTrigger(kind, reason) {
      if (settled || terminalTrigger !== null) return false;
      terminalTrigger = Object.freeze({ kind, reason });
      return true;
    }

    function hasExplainableExit() {
      return (
        (Number.isInteger(exitCode) && exitSignal === null) ||
        (exitCode === null &&
          typeof exitSignal === 'string' &&
          exitSignal.length !== 0)
      );
    }

    function originalTerminationConfirmed() {
      return (
        exitObserved &&
        stdoutCompleted &&
        stderrCompleted &&
        closeObserved
      );
    }

    function confirmedTerminationError() {
      if (terminationOriginalReason === SUBPROCESS_REASONS.TIMEOUT) {
        return subprocessBuildError(
          'MOXLEY_NATIVE_BUILD_SUBPROCESS_TIMED_OUT',
          terminationOriginalReason,
          true,
        );
      }
      if (
        terminationOriginalReason === SUBPROCESS_REASONS.STDOUT_LIMIT ||
        terminationOriginalReason === SUBPROCESS_REASONS.STDERR_LIMIT
      ) {
        return subprocessBuildError(
          'MOXLEY_NATIVE_BUILD_SUBPROCESS_OUTPUT_LIMIT',
          terminationOriginalReason,
          true,
        );
      }
      return subprocessBuildError(
        'MOXLEY_NATIVE_BUILD_SUBPROCESS_EXIT_FAILED',
        SUBPROCESS_REASONS.EXIT_WITHOUT_CLOSE,
        true,
      );
    }

    function maybeFinishTerminationConfirmation() {
      if (
        settled ||
        !terminationStarted ||
        !terminationConfirmationReady
      ) {
        return;
      }
      if (originalTerminationConfirmed()) {
        settleError(confirmedTerminationError());
      }
    }

    function beginPostTerminationConfirmation() {
      if (settled) return;
      terminationConfirmationReady = true;
      if (originalTerminationConfirmed()) {
        settleError(confirmedTerminationError());
        return;
      }
      postTerminationTimer = setTimeout(() => {
        postTerminationTimer = null;
        settleError(
          terminationUnconfirmedError(
            SUBPROCESS_REASONS.TERMINATION_NOT_CONFIRMED,
            terminationOriginalReason,
          ),
        );
      }, postTerminationGraceMs);
    }

    async function beginTermination(reason) {
      if (settled || terminationStarted) return;
      terminationStarted = true;
      terminationOriginalReason = reason;
      acceptingOutput = false;
      if (executionTimer !== null) clearTimeout(executionTimer);
      if (exitCloseTimer !== null) clearTimeout(exitCloseTimer);
      executionTimer = null;
      exitCloseTimer = null;

      if (exitObserved) {
        beginPostTerminationConfirmation();
        return;
      }
      if (!spawnObserved || child === null) {
        settleError(
          terminationUnconfirmedError(
            SUBPROCESS_REASONS.TERMINATION_TOOL_FAILED,
            terminationOriginalReason,
          ),
        );
        return;
      }

      const supervisedChild = child;
      const pid = supervisedChild.pid;
      const taskkillResult = await runTaskkill(
        supervisedChild,
        pid,
        () => exitObserved,
        terminationObserver,
      );
      if (settled) return;
      if (taskkillResult === 'failed') {
        settleError(
          terminationUnconfirmedError(
            SUBPROCESS_REASONS.TERMINATION_TOOL_FAILED,
            terminationOriginalReason,
          ),
        );
        return;
      }
      beginPostTerminationConfirmation();
    }

    function maybeFinishExit() {
      if (
        settled ||
        terminationStarted ||
        terminalTrigger === null ||
        terminalTrigger.kind !== 'exit'
      ) {
        return;
      }
      if (
        exitObserved &&
        stdoutCompleted &&
        stderrCompleted &&
        closeObserved &&
        !stdoutOverflowed &&
        !stderrOverflowed &&
        hasExplainableExit()
      ) {
        settleResult();
        return;
      }
      if (exitObserved && exitCloseTimer === null) {
        exitCloseTimer = setTimeout(() => {
          exitCloseTimer = null;
          void beginTermination(SUBPROCESS_REASONS.EXIT_WITHOUT_CLOSE);
        }, exitCloseGraceMs);
      }
    }

    function onSpawn() {
      spawnObserved = true;
      if (
        acceptedTestControl !== null &&
        acceptedTestControl.signalAfterSpawn
      ) {
        try {
          child.kill('SIGTERM');
        } catch {
          // The execution timer remains the bound if the test-only signal fails.
        }
      }
    }

    function onChildError() {
      if (!spawnObserved && selectTerminalTrigger('spawn-error', SUBPROCESS_REASONS.SPAWN_ERROR)) {
        settleError(
          subprocessBuildError(
            'MOXLEY_NATIVE_BUILD_SUBPROCESS_SPAWN_FAILED',
            SUBPROCESS_REASONS.SPAWN_ERROR,
            false,
          ),
        );
      }
    }

    function onExit(code, signal) {
      exitObserved = true;
      exitCode = code;
      exitSignal = signal;
      if (selectTerminalTrigger('exit', null)) {
        if (executionTimer !== null) clearTimeout(executionTimer);
        executionTimer = null;
        maybeFinishExit();
      } else {
        maybeFinishTerminationConfirmation();
      }
    }

    function onClose() {
      closeObserved = true;
      maybeFinishExit();
      maybeFinishTerminationConfirmation();
    }

    function retainChunk(chunks, chunk, length) {
      const remaining = MAX_PROCESS_OUTPUT_BYTES - length;
      if (remaining <= 0) return 0;
      const accepted = Math.min(remaining, chunk.length);
      if (accepted !== 0) chunks.push(chunk.subarray(0, accepted));
      return accepted;
    }

    function onStdoutData(chunk) {
      if (!acceptingOutput) return;
      const accepted = retainChunk(stdoutChunks, chunk, stdoutLength);
      stdoutLength += accepted;
      if (accepted !== chunk.length) {
        if (
          selectTerminalTrigger(
            'stdout-overflow',
            SUBPROCESS_REASONS.STDOUT_LIMIT,
          )
        ) {
          stdoutOverflowed = true;
          acceptingOutput = false;
          void beginTermination(SUBPROCESS_REASONS.STDOUT_LIMIT);
        }
      }
    }

    function onStderrData(chunk) {
      if (!acceptingOutput) return;
      const accepted = retainChunk(stderrChunks, chunk, stderrLength);
      stderrLength += accepted;
      if (accepted !== chunk.length) {
        if (
          selectTerminalTrigger(
            'stderr-overflow',
            SUBPROCESS_REASONS.STDERR_LIMIT,
          )
        ) {
          stderrOverflowed = true;
          acceptingOutput = false;
          void beginTermination(SUBPROCESS_REASONS.STDERR_LIMIT);
        }
      }
    }

    function onStdoutEnd() {
      stdoutCompleted = true;
      maybeFinishExit();
      maybeFinishTerminationConfirmation();
    }

    function onStderrEnd() {
      stderrCompleted = true;
      maybeFinishExit();
      maybeFinishTerminationConfirmation();
    }

    function onStdinError() {
      // Stdin failure is bounded by the existing terminal-trigger state machine.
    }

    function onStdoutError() {
      stdoutCompleted = false;
    }

    function onStderrError() {
      stderrCompleted = false;
    }

    function onExecutionTimeout() {
      executionTimer = null;
      if (selectTerminalTrigger('timeout', SUBPROCESS_REASONS.TIMEOUT)) {
        acceptingOutput = false;
        void beginTermination(SUBPROCESS_REASONS.TIMEOUT);
      }
    }

    executionTimer = setTimeout(onExecutionTimeout, timeoutMs);
    try {
      child = spawn(file, arguments_, {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch {
      selectTerminalTrigger('spawn-error', SUBPROCESS_REASONS.SPAWN_ERROR);
      settleError(
        subprocessBuildError(
          'MOXLEY_NATIVE_BUILD_SUBPROCESS_SPAWN_FAILED',
          SUBPROCESS_REASONS.SPAWN_ERROR,
          false,
        ),
      );
      return;
    }

    stdin = child.stdin;
    stdout = child.stdout;
    stderr = child.stderr;
    child.once('spawn', onSpawn);
    child.on('error', onChildError);
    child.once('exit', onExit);
    child.once('close', onClose);
    stdin.on('error', onStdinError);
    stdout.on('data', onStdoutData);
    stdout.once('end', onStdoutEnd);
    stdout.on('error', onStdoutError);
    stderr.on('data', onStderrData);
    stderr.once('end', onStderrEnd);
    stderr.on('error', onStderrError);

    try {
      if (options.stdin === undefined) stdin.end();
      else stdin.end(options.stdin);
    } catch {
      // Invalid or closed stdin cannot escape the bounded state machine.
    }
  });
}

async function requireProcessSuccess(
  label,
  file,
  arguments_,
  options,
  testControl = null,
) {
  const result = await runProcess(file, arguments_, options, testControl);
  if (result.signal !== null) {
    throw subprocessBuildError(
      'MOXLEY_NATIVE_BUILD_SUBPROCESS_EXIT_FAILED',
      SUBPROCESS_REASONS.SIGNALLED_EXIT,
      true,
    );
  }
  if (result.code !== 0) {
    throw subprocessBuildError(
      'MOXLEY_NATIVE_BUILD_SUBPROCESS_EXIT_FAILED',
      SUBPROCESS_REASONS.NONZERO_EXIT,
      true,
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

function testProcessInvocation(options = {}) {
  const productionOptions = { ...options };
  const exitCloseGraceMs = productionOptions.exitCloseGraceMs;
  const postTerminationGraceMs = productionOptions.postTerminationGraceMs;
  const onTerminationAttempt = productionOptions.onTerminationAttempt;
  const signalAfterSpawn = productionOptions.signalAfterSpawn;
  const retainFailureOutput = productionOptions.retainFailureOutput;
  delete productionOptions.exitCloseGraceMs;
  delete productionOptions.postTerminationGraceMs;
  delete productionOptions.onTerminationAttempt;
  delete productionOptions.signalAfterSpawn;
  delete productionOptions.retainFailureOutput;

  function testGrace(value, fallback) {
    if (value === undefined) return fallback;
    if (!Number.isSafeInteger(value) || value <= 0 || value > fallback) {
      throw buildError(
        'MOXLEY_NATIVE_BUILD_TEST_SCOPE_INVALID',
        'Injected native build test scope is invalid.',
      );
    }
    return value;
  }

  if (
    onTerminationAttempt !== undefined &&
    typeof onTerminationAttempt !== 'function'
  ) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_TEST_SCOPE_INVALID',
      'Injected native build test scope is invalid.',
    );
  }
  if (signalAfterSpawn !== undefined && signalAfterSpawn !== true) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_TEST_SCOPE_INVALID',
      'Injected native build test scope is invalid.',
    );
  }
  if (
    retainFailureOutput !== undefined &&
    retainFailureOutput !== true
  ) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_TEST_SCOPE_INVALID',
      'Injected native build test scope is invalid.',
    );
  }

  return Object.freeze({
    options: productionOptions,
    control: Object.freeze({
      token: TEST_CONTROL_TOKEN,
      exitCloseGraceMs: testGrace(exitCloseGraceMs, EXIT_CLOSE_GRACE_MS),
      postTerminationGraceMs: testGrace(
        postTerminationGraceMs,
        POST_TERMINATION_GRACE_MS,
      ),
      onTerminationAttempt: onTerminationAttempt ?? null,
      signalAfterSpawn: signalAfterSpawn === true,
      retainFailureOutput: retainFailureOutput === true,
    }),
  });
}

function runProcessForTest(file, arguments_, options) {
  const invocation = testProcessInvocation(options);
  return runProcess(file, arguments_, invocation.options, invocation.control);
}

function requireProcessSuccessForTest(label, file, arguments_, options) {
  const invocation = testProcessInvocation(options);
  return requireProcessSuccess(
    label,
    file,
    arguments_,
    invocation.options,
    invocation.control,
  );
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
      timeoutMs: AUTHENTICATION_TIMEOUT_MS,
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
  } catch (error) {
    if (isSubprocessBuildError(error)) throw error;
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

async function authenticateTerminationExecutable() {
  if (cachedTaskkillAuthentication !== null) {
    return cachedTaskkillAuthentication;
  }

  try {
    const windowsMetadata = await fsp.lstat(WINDOWS_ROOT, { bigint: true });
    const system32Metadata = await fsp.lstat(SYSTEM32, { bigint: true });
    const executableMetadata = await fsp.lstat(TASKKILL_EXE, { bigint: true });
    if (
      !windowsMetadata.isDirectory() ||
      windowsMetadata.isSymbolicLink() ||
      !system32Metadata.isDirectory() ||
      system32Metadata.isSymbolicLink() ||
      !executableMetadata.isFile() ||
      executableMetadata.isSymbolicLink()
    ) {
      throw new Error('TERMINATION_EXECUTABLE_TYPE_INVALID');
    }

    const canonicalWindows = await fsp.realpath(WINDOWS_ROOT);
    const canonicalSystem32 = await fsp.realpath(SYSTEM32);
    const canonicalExecutable = await fsp.realpath(TASKKILL_EXE);
    if (
      !sameWindowsPath(canonicalWindows, WINDOWS_ROOT) ||
      !sameWindowsPath(canonicalSystem32, SYSTEM32) ||
      !sameWindowsPath(canonicalExecutable, TASKKILL_EXE)
    ) {
      throw new Error('TERMINATION_EXECUTABLE_CANONICAL_INVALID');
    }

    const canonicalWindowsMetadata = await fsp.stat(canonicalWindows, {
      bigint: true,
    });
    const canonicalSystem32Metadata = await fsp.stat(canonicalSystem32, {
      bigint: true,
    });
    const canonicalExecutableMetadata = await fsp.stat(canonicalExecutable, {
      bigint: true,
    });
    const windowsIdentity = identityOf(windowsMetadata);
    const system32Identity = identityOf(system32Metadata);
    const executableIdentity = identityOf(executableMetadata);
    if (
      !sameIdentity(canonicalWindowsMetadata, windowsIdentity, false) ||
      !sameIdentity(canonicalSystem32Metadata, system32Identity, false) ||
      !sameIdentity(canonicalExecutableMetadata, executableIdentity, true)
    ) {
      throw new Error('TERMINATION_EXECUTABLE_IDENTITY_INVALID');
    }

    const authenticated = Object.freeze({
      windowsRoot: windowsIdentity,
      system32: system32Identity,
      executable: executableIdentity,
    });
    cachedTaskkillAuthentication = authenticated;
    return authenticated;
  } catch {
    throw terminationUnconfirmedError(
      SUBPROCESS_REASONS.TERMINATION_TOOL_FAILED,
    );
  }
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

async function assertBuildCollisionPathsAbsent(paths) {
  await assertAbsent(paths.disposition, true);
  await assertAbsent(paths.artifact, true);
  await assertAbsent(paths.receipt, true);
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

async function createOwnedStagingDirectory(state) {
  const target = state.paths.staging;
  if (!isStrictDescendant(state.paths.release, target)) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_STAGE_INVALID',
      'Native build staging is outside the package boundary.',
    );
  }
  try {
    await fsp.mkdir(target, { recursive: false });
  } catch {
    state.stagingCreated = true;
    state.stagingIdentity = null;
    throw buildError(
      'MOXLEY_NATIVE_BUILD_STAGE_INVALID',
      'Native build staging could not be created without collision.',
    );
  }

  state.stagingCreated = true;
  let createdMetadata;
  try {
    createdMetadata = await fsp.lstat(target, { bigint: true });
  } catch {
    state.stagingIdentity = null;
    throw buildError(
      'MOXLEY_NATIVE_BUILD_STAGE_INVALID',
      'Native build staging identity could not be recorded.',
    );
  }
  if (!createdMetadata.isDirectory() || createdMetadata.isSymbolicLink()) {
    state.stagingIdentity = null;
    throw buildError(
      'MOXLEY_NATIVE_BUILD_STAGE_INVALID',
      'Native build staging has an unexpected type.',
    );
  }
  state.stagingIdentity = identityOf(createdMetadata);

  if (state[STAGING_AUTH_TEST_ERROR] instanceof NativeBuildError) {
    const injected = state[STAGING_AUTH_TEST_ERROR];
    state[STAGING_AUTH_TEST_ERROR] = null;
    throw injected;
  }

  const authenticated = await authenticatePath(target, 'directory');
  if (!sameIdentity(authenticated, state.stagingIdentity, false)) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_STAGE_INVALID',
      'Native build staging identity changed.',
    );
  }
  return authenticated;
}

async function localExistingMetadata(target) {
  try {
    return await fsp.lstat(target, { bigint: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw buildError(
      'MOXLEY_NATIVE_BUILD_PATH_INVALID',
      'A native build path could not be authenticated.',
    );
  }
}

async function preflightBuildDirectories(canonicalRoot, paths) {
  const rootMetadata = await fsp.lstat(canonicalRoot, { bigint: true });
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_PATH_INVALID',
      'The native build package root identity changed.',
    );
  }
  const rootIdentity = identityOf(rootMetadata);
  const buildExisting = await localExistingMetadata(paths.build);
  let buildIdentity = null;
  if (buildExisting !== null) {
    const authenticated = await authenticatePath(paths.build, 'directory');
    buildIdentity = identityOf(authenticated);
  }
  const releaseExisting = await localExistingMetadata(paths.release);
  let releaseIdentity = null;
  if (releaseExisting !== null) {
    if (buildIdentity === null) {
      throw buildError(
        'MOXLEY_NATIVE_BUILD_PATH_INVALID',
        'A native build directory has an unexpected parent.',
      );
    }
    const authenticated = await authenticatePath(paths.release, 'directory');
    releaseIdentity = identityOf(authenticated);
  }
  return Object.freeze({ rootIdentity, buildIdentity, releaseIdentity });
}

async function createOrdinaryDirectoryLocally(target, parent, parentIdentity) {
  if (!isStrictDescendant(parent, target)) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_PATH_INVALID',
      'A native build directory is outside the package boundary.',
    );
  }
  await requireLocalDirectoryIdentity(parent, parentIdentity);
  try {
    await fsp.mkdir(target, { recursive: false });
  } catch {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_PATH_INVALID',
      'A native build directory could not be created.',
    );
  }
  const metadata = await fsp.lstat(target, { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_PATH_INVALID',
      'A native build directory has an unexpected type.',
    );
  }
  const canonical = await fsp.realpath(target);
  if (!sameWindowsPath(canonical, target)) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_PATH_INVALID',
      'A native build directory has an unexpected canonical identity.',
    );
  }
  await requireLocalDirectoryIdentity(parent, parentIdentity);
  return identityOf(metadata);
}

async function establishBuildDirectoriesLocally(
  canonicalRoot,
  paths,
  preflight,
) {
  await requireLocalDirectoryIdentity(canonicalRoot, preflight.rootIdentity);
  const buildIdentity =
    preflight.buildIdentity === null
      ? await createOrdinaryDirectoryLocally(
          paths.build,
          canonicalRoot,
          preflight.rootIdentity,
        )
      : preflight.buildIdentity;
  await requireLocalDirectoryIdentity(paths.build, buildIdentity);
  const releaseIdentity =
    preflight.releaseIdentity === null
      ? await createOrdinaryDirectoryLocally(
          paths.release,
          paths.build,
          buildIdentity,
        )
      : preflight.releaseIdentity;
  await requireLocalDirectoryIdentity(paths.release, releaseIdentity);
  return Object.freeze({ buildIdentity, releaseIdentity });
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
    disposition: path.join(root, ...DISPOSITION_RELATIVE.split('/')),
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
    decodeCanonicalJson(bytes, MAX_CARRIER_BYTES),
    expectedKey,
    expectedPipe,
  );
}

function createV2LockRecord(key, pipeName, stagingName, nonce) {
  return Object.freeze({
    lockFormat: LOCK_FORMAT,
    lockVersion: 2,
    repositoryKey: key,
    pipeName,
    stagingName,
    nonce,
    disposition: 'ACTIVE',
  });
}

function validateV2LockRecord(value, expectedKey, expectedPipe) {
  if (
    !exactKeys(value, LOCK_V2_KEYS) ||
    value.lockFormat !== LOCK_FORMAT ||
    value.lockVersion !== 2 ||
    value.repositoryKey !== expectedKey ||
    !HEX_64.test(value.repositoryKey) ||
    value.pipeName !== expectedPipe ||
    value.stagingName !== `${STAGING_PREFIX}${value.stagingName.slice(-32)}` ||
    !HEX_32.test(value.stagingName.slice(STAGING_PREFIX.length)) ||
    !HEX_32.test(value.nonce) ||
    value.disposition !== 'ACTIVE'
  ) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_LOCK_INVALID',
      'Native build lock evidence is invalid.',
    );
  }
  return value;
}

function decodeV2LockBytes(bytes, expectedKey, expectedPipe) {
  return validateV2LockRecord(
    decodeCanonicalJson(bytes, MAX_CARRIER_BYTES),
    expectedKey,
    expectedPipe,
  );
}

function classifyLockCarrierBytes(bytes, expectedKey, expectedPipe) {
  const value = decodeCanonicalJson(bytes, MAX_CARRIER_BYTES);
  if (value.lockVersion === 1) {
    const record = validateLockRecord(value, expectedKey, expectedPipe);
    return Object.freeze({
      kind: 'LEGACY_V1',
      record: Object.freeze({ ...record }),
    });
  }
  if (value.lockVersion === 2) {
    const record = validateV2LockRecord(value, expectedKey, expectedPipe);
    return Object.freeze({
      kind: 'ACTIVE_V2',
      record: Object.freeze({ ...record }),
    });
  }
  throw buildError(
    'MOXLEY_NATIVE_BUILD_LOCK_INVALID',
    'Native build lock evidence is invalid.',
  );
}

function validateDispositionRecord(value, lock) {
  if (
    !exactKeys(value, DISPOSITION_KEYS) ||
    value.dispositionFormat !== DISPOSITION_FORMAT ||
    value.dispositionVersion !== 1 ||
    value.lockVersion !== 2 ||
    value.repositoryKey !== lock.repositoryKey ||
    value.pipeName !== lock.pipeName ||
    value.stagingName !== lock.stagingName ||
    value.nonce !== lock.nonce
  ) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_DISPOSITION_INVALID',
      'Native build disposition evidence is invalid.',
    );
  }
  const positive =
    value.disposition === 'CLEAN_AUTHORIZED' &&
    value.reason === null &&
    value.causeReason === null;
  const negative =
    value.disposition === 'TERMINATION_UNCONFIRMED' &&
    TERMINATION_DISPOSITION_REASONS.includes(value.reason) &&
    TERMINATION_DISPOSITION_CAUSES.includes(value.causeReason);
  if (!positive && !negative) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_DISPOSITION_INVALID',
      'Native build disposition evidence is invalid.',
    );
  }
  return value;
}

function createDispositionRecord(lock, disposition, reason, causeReason) {
  validateV2LockRecord(lock, lock.repositoryKey, lock.pipeName);
  return Object.freeze(
    validateDispositionRecord(
      {
        dispositionFormat: DISPOSITION_FORMAT,
        dispositionVersion: 1,
        lockVersion: 2,
        repositoryKey: lock.repositoryKey,
        pipeName: lock.pipeName,
        stagingName: lock.stagingName,
        nonce: lock.nonce,
        disposition,
        reason,
        causeReason,
      },
      lock,
    ),
  );
}

function decodeDispositionBytes(bytes, lock) {
  validateV2LockRecord(lock, lock.repositoryKey, lock.pipeName);
  return Object.freeze(
    validateDispositionRecord(
      decodeCanonicalJson(bytes, MAX_CARRIER_BYTES),
      lock,
    ),
  );
}

async function readBoundedCarrier(handle) {
  const output = Buffer.alloc(MAX_CARRIER_BYTES + 1);
  let offset = 0;
  while (offset < output.length) {
    const result = await handle.read(
      output,
      offset,
      output.length - offset,
      offset,
    );
    if (result.bytesRead === 0) return output.subarray(0, offset);
    offset += result.bytesRead;
  }
  throw buildError(
    'MOXLEY_NATIVE_BUILD_EVIDENCE_INVALID',
    'Canonical native build evidence is invalid.',
  );
}

async function startLease(pipeName) {
  return new Promise((resolve, reject) => {
    const sockets = new Set();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
      socket.destroy();
    });
    let settled = false;
    let closePromise = null;
    let abandoned = false;
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
        close() {
          if (abandoned) return Promise.resolve();
          if (closePromise === null) {
            closePromise = new Promise((resolveClose, rejectClose) => {
              try {
                server.close((error) => {
                  if (error) {
                    rejectClose(error);
                    return;
                  }
                  resolveClose();
                });
              } catch (error) {
                rejectClose(error);
              }
            });
          }
          return closePromise;
        },
        abandon() {
          if (abandoned) return;
          abandoned = true;
          for (const socket of sockets) {
            try {
              socket.destroy();
            } catch {}
            try {
              socket.unref();
            } catch {}
          }
          try {
            server.close(() => {});
          } catch {}
          try {
            if (typeof server.closeAllConnections === 'function') {
              server.closeAllConnections();
            }
          } catch {}
          try {
            server.unref();
          } catch {}
        },
      });
    });
  });
}

function appendCarrierJournal(state, entry) {
  if (Array.isArray(state.journal)) state.journal.push(entry);
}

function carrierFailure(carrier, collision = false) {
  if (carrier === 'lock') {
    return buildError(
      collision
        ? 'MOXLEY_NATIVE_BUILD_BUSY'
        : 'MOXLEY_NATIVE_BUILD_LOCK_FAILED',
      collision
        ? 'Native build is already active or locked.'
        : 'Native build lock creation or verification failed.',
    );
  }
  return buildError(
    collision
      ? 'MOXLEY_NATIVE_BUILD_COLLISION'
      : 'MOXLEY_NATIVE_BUILD_DISPOSITION_FAILED',
    collision
      ? 'Generated native output already exists; run explicit clean.'
      : 'Native build disposition recording failed.',
  );
}

function validateCarrierTestControl(control) {
  if (control === null) return null;
  if (
    control === null ||
    typeof control !== 'object' ||
    control.token !== CARRIER_TEST_CONTROL_TOKEN ||
    !exactKeys(control, ['token', 'fault']) ||
    !CARRIER_FAULTS.includes(control.fault)
  ) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_TEST_SCOPE_INVALID',
      'Injected native build test scope is invalid.',
    );
  }
  return control;
}

function throwCarrierFault(state, carrier, fault) {
  appendCarrierJournal(state, `${carrier}:fault:${fault}`);
  throw carrierFailure(carrier);
}

async function requireLocalDirectoryIdentity(target, expectedIdentity) {
  let metadata;
  try {
    metadata = await fsp.lstat(target, { bigint: true });
  } catch {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_PATH_INVALID',
      'A native build directory identity changed.',
    );
  }
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    !sameIdentity(metadata, expectedIdentity, false)
  ) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_PATH_INVALID',
      'A native build directory identity changed.',
    );
  }
  return metadata;
}

async function authenticateCarrierLocally(target, expectedIdentity, byteLength) {
  let metadata;
  try {
    metadata = await fsp.lstat(target, { bigint: true });
  } catch {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_EVIDENCE_INVALID',
      'Canonical native build evidence is invalid.',
    );
  }
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    !sameIdentity(metadata, expectedIdentity, false) ||
    metadata.size !== BigInt(byteLength)
  ) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_EVIDENCE_INVALID',
      'Canonical native build evidence is invalid.',
    );
  }
  return metadata;
}

async function closeCarrierHandleOnce(handle) {
  await handle.close();
}

async function writeOnceCarrier(options) {
  const {
    state,
    carrier,
    target,
    parent,
    parentIdentity,
    bytes,
    expectedKey,
    expectedPipe,
    lock,
  } = options;
  const control = validateCarrierTestControl(options.testControl ?? null);
  if (
    !['lock', 'disposition'].includes(carrier) ||
    !Buffer.isBuffer(bytes) ||
    bytes.length === 0 ||
    bytes.length > MAX_CARRIER_BYTES ||
    path.dirname(target).toLowerCase() !== parent.toLowerCase()
  ) {
    throw carrierFailure(carrier);
  }
  await requireLocalDirectoryIdentity(parent, parentIdentity);
  if (control?.fault === 'create') {
    throwCarrierFault(state, carrier, 'create');
  }

  let handle;
  try {
    handle = await fsp.open(target, 'wx', 0o600);
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      appendCarrierJournal(state, `${carrier}:collision`);
      throw carrierFailure(carrier, true);
    }
    throw carrierFailure(carrier);
  }
  if (carrier === 'lock') {
    state.lockOwned = true;
    state.lockPublication = 'LOCK_CREATED_UNVERIFIED';
  } else {
    state.dispositionCreated = true;
  }
  appendCarrierJournal(state, `${carrier}:create`);
  if (carrier === 'disposition') {
    emitDiagnosticPhase(
      state.diagnosticControl ?? null,
      'DISPOSITION_CREATE_DONE',
    );
  }

  let writeIdentity;
  let pendingError = null;
  try {
    const metadata = await handle.stat({ bigint: true });
    if (!metadata.isFile() || metadata.size !== 0n) {
      throw carrierFailure(carrier);
    }
    writeIdentity = identityOf(metadata);
    appendCarrierJournal(state, `${carrier}:stat`);

    if (control?.fault === 'write-zero') {
      appendCarrierJournal(state, `${carrier}:write`);
      throwCarrierFault(state, carrier, 'write-zero');
    }
    const writeLength =
      control?.fault === 'write-partial'
        ? Math.max(1, Math.floor(bytes.length / 2))
        : bytes.length;
    const writeResult = await handle.write(bytes, 0, writeLength, 0);
    appendCarrierJournal(state, `${carrier}:write`);
    if (carrier === 'disposition') {
      emitDiagnosticPhase(
        state.diagnosticControl ?? null,
        'DISPOSITION_WRITE_DONE',
      );
    }
    if (writeResult.bytesWritten !== writeLength) throw carrierFailure(carrier);
    if (control?.fault === 'write-partial') {
      throwCarrierFault(state, carrier, 'write-partial');
    }
    if (control?.fault === 'sync') {
      throwCarrierFault(state, carrier, 'sync');
    }
    await handle.sync();
    appendCarrierJournal(state, `${carrier}:sync`);
    if (carrier === 'disposition') {
      emitDiagnosticPhase(
        state.diagnosticControl ?? null,
        'DISPOSITION_SYNC_DONE',
      );
    }
  } catch (error) {
    pendingError = error;
  }

  try {
    await closeCarrierHandleOnce(handle);
    appendCarrierJournal(state, `${carrier}:close`);
    if (carrier === 'disposition') {
      emitDiagnosticPhase(
        state.diagnosticControl ?? null,
        'DISPOSITION_CLOSE_DONE',
      );
    }
    if (pendingError === null && control?.fault === 'close') {
      throwCarrierFault(state, carrier, 'close');
    }
  } catch (error) {
    if (pendingError === null) pendingError = error;
  }
  if (pendingError !== null) throw carrierFailure(carrier);

  if (control?.fault === 'authentication') {
    throwCarrierFault(state, carrier, 'authentication');
  }
  await requireLocalDirectoryIdentity(parent, parentIdentity);
  const pathMetadata = await authenticateCarrierLocally(
    target,
    writeIdentity,
    bytes.length,
  );
  const finalIdentity = identityOf(pathMetadata);
  appendCarrierJournal(state, `${carrier}:authenticate`);
  if (carrier === 'disposition') {
    emitDiagnosticPhase(
      state.diagnosticControl ?? null,
      'DISPOSITION_AUTHENTICATE_DONE',
    );
  }

  let readHandle;
  let actual;
  let readError = null;
  try {
    readHandle = await fsp.open(target, 'r');
    const handleMetadata = await readHandle.stat({ bigint: true });
    if (!sameIdentity(handleMetadata, finalIdentity, true)) {
      throw carrierFailure(carrier);
    }
    actual = await readBoundedCarrier(readHandle);
  } catch (error) {
    readError = error;
  }
  if (readHandle !== undefined) {
    try {
      await closeCarrierHandleOnce(readHandle);
    } catch (error) {
      if (readError === null) readError = error;
    }
  }
  if (readError !== null) throw carrierFailure(carrier);
  if (control?.fault === 'readback') {
    throwCarrierFault(state, carrier, 'readback');
  }
  await authenticateCarrierLocally(target, finalIdentity, bytes.length);
  const record =
    carrier === 'lock'
      ? decodeV2LockBytes(actual, expectedKey, expectedPipe)
      : decodeDispositionBytes(actual, lock);
  if (!actual.equals(bytes)) throw carrierFailure(carrier);
  appendCarrierJournal(state, `${carrier}:readback`);
  if (carrier === 'disposition') {
    emitDiagnosticPhase(
      state.diagnosticControl ?? null,
      'DISPOSITION_READBACK_DONE',
    );
  }
  return Object.freeze({
    record: Object.freeze({ ...record }),
    bytes: Buffer.from(actual),
    identity: finalIdentity,
  });
}

async function acquireV2Lock(state, record, bytes, testControl = null) {
  const result = await writeOnceCarrier({
    state,
    carrier: 'lock',
    target: state.paths.lock,
    parent: state.paths.release,
    parentIdentity: state.releaseIdentity,
    bytes,
    expectedKey: record.repositoryKey,
    expectedPipe: record.pipeName,
    lock: null,
    testControl,
  });
  state.lockRecord = result.record;
  state.lockBytes = result.bytes;
  state.lockIdentity = result.identity;
  state.lockPublication = 'ACTIVE_VERIFIED';
  return result;
}

function validateHostEvidence(host) {
  const keys = Object.keys(EXPECTED_HOST);
  const mismatch = keys.find((key) => host?.[key] !== EXPECTED_HOST[key]);
  if (!exactKeys(host, keys) || mismatch !== undefined) {
    const field = mismatch ?? 'keys';
    const expected = mismatch === undefined ? keys.join(',') : EXPECTED_HOST[field];
    const actual = mismatch === undefined
      ? Object.keys(host ?? {}).join(',')
      : String(host?.[field]);
    throw buildError(
      'MOXLEY_NATIVE_BUILD_INPUT_INVALID',
      'Exact Windows host and filesystem were not authenticated. ' +
        `${field} expected=${expected} actual=${actual.replace(/[\r\n]/g, ' ').slice(0, 80)}`,
    );
  }
  return Object.freeze({ ...host });
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
  return validateHostEvidence(host);
}

function validateNodeRuntimeInputs(runtime) {
  if (
    runtime.platform !== 'win32' ||
    runtime.arch !== 'x64' ||
    runtime.version !== 'v24.13.0' ||
    runtime.versions.modules !== '137' ||
    runtime.versions.napi !== '10'
  ) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_INPUT_INVALID',
      'Exact Node runtime inputs were not authenticated.',
    );
  }
}

async function authenticatePackageRoot() {
  validateNodeRuntimeInputs(process);
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

async function authenticateStagingDirectory(
  state,
  emitStagingPhases = false,
) {
  const diagnosticControl =
    emitStagingPhases ? state.diagnosticControl ?? null : null;
  emitDiagnosticPhase(diagnosticControl, 'STAGING_ROOT_BEGIN');
  const metadata = await authenticatePath(state.paths.staging, 'directory');
  if (!sameIdentity(metadata, state.stagingIdentity, false)) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_STAGE_INVALID',
      'Native build staging identity changed.',
    );
  }
  emitDiagnosticPhase(diagnosticControl, 'STAGING_ROOT_DONE');
  return inventoryStagingTree(
    state.paths.staging,
    state.allowedStagingNames,
    false,
    diagnosticControl,
  );
}

async function inventoryStagingTree(
  staging,
  allowedFileNames,
  allowCleanupPrefixes = false,
  diagnosticControl = null,
) {
  if (typeof allowCleanupPrefixes !== 'boolean') {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_STAGE_INVALID',
      'Native build staging cleanup policy is invalid.',
    );
  }
  const topNames = (await fsp.readdir(staging)).sort(ordinalCompare);
  emitDiagnosticPhase(diagnosticControl, 'STAGING_READDIR_DONE', {
    entryCount: topNames.length,
  });
  const files = [];
  const directories = [];
  for (let ordinal = 0; ordinal < topNames.length; ordinal += 1) {
    const name = topNames[ordinal];
    const target = path.join(staging, name);
    if (allowedFileNames.has(name)) {
      emitDiagnosticPhase(diagnosticControl, 'STAGING_ENTRY_BEGIN', {
        kind: 'file',
        ordinal,
      });
      const metadata = await authenticatePath(target, 'file');
      files.push(
        Object.freeze({ target, identity: identityOf(metadata) }),
      );
      emitDiagnosticPhase(diagnosticControl, 'STAGING_ENTRY_DONE', {
        kind: 'file',
        ordinal,
      });
      continue;
    }
    if (name !== 'Microsoft') {
      throw buildError(
        'MOXLEY_NATIVE_BUILD_STAGE_INVALID',
        'Native build staging contains an unexpected entry.',
      );
    }
    emitDiagnosticPhase(diagnosticControl, 'STAGING_ENTRY_BEGIN', {
      kind: 'directory',
      ordinal,
    });
    const microsoftMetadata = await authenticatePath(target, 'directory');
    const microsoftChildren = await fsp.readdir(target);
    if (allowCleanupPrefixes && microsoftChildren.length === 0) {
      directories.push(
        Object.freeze({ target, identity: identityOf(microsoftMetadata) }),
      );
      emitDiagnosticPhase(diagnosticControl, 'STAGING_ENTRY_DONE', {
        kind: 'directory',
        ordinal,
      });
      continue;
    }
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
    if (allowCleanupPrefixes && insightChildren.length === 0) {
      directories.push(
        Object.freeze({ target: insights, identity: identityOf(insightsMetadata) }),
        Object.freeze({ target, identity: identityOf(microsoftMetadata) }),
      );
      continue;
    }
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
    emitDiagnosticPhase(diagnosticControl, 'STAGING_ENTRY_DONE', {
      kind: 'directory',
      ordinal,
    });
  }
  return Object.freeze({
    files: Object.freeze(files),
    directories: Object.freeze(directories),
  });
}

async function prepareAuthenticatedStagingRetention(state) {
  if (!state.stagingCreated) return null;
  if (state.stagingIdentity === null) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_STAGE_INVALID',
      'Native build staging identity is unavailable.',
    );
  }
  const inventory = await authenticateStagingDirectory(state);
  const directory = await fsp.lstat(state.paths.staging, { bigint: true });
  if (!sameIdentity(directory, state.stagingIdentity, false)) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_STAGE_INVALID',
      'Native build staging identity changed.',
    );
  }
  return Object.freeze({
    files: inventory.files,
    directories: inventory.directories,
    staging: Object.freeze({
      target: state.paths.staging,
      identity: state.stagingIdentity,
    }),
  });
}

async function prepareRetentionPlan(state) {
  const staging = await prepareAuthenticatedStagingRetention(state);
  emitDiagnosticPhase(
    state.diagnosticControl ?? null,
    'RETENTION_STAGING_DONE',
  );
  if (
    state.lockPublication !== 'ACTIVE_VERIFIED' ||
    !state.lockOwned ||
    state.lockIdentity === null ||
    state.lockRecord === null ||
    state.lockBytes === null
  ) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_LOCK_INVALID',
      'Native build lock evidence is invalid.',
    );
  }
  const lockMetadata = await authenticatePath(state.paths.lock, 'file');
  if (!sameIdentity(lockMetadata, state.lockIdentity, true)) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_LOCK_INVALID',
      'Native build lock evidence is invalid.',
    );
  }
  emitDiagnosticPhase(state.diagnosticControl ?? null, 'LOCK_AUTH_DONE');
  const lockBytes = await fsp.readFile(state.paths.lock);
  decodeV2LockBytes(
    lockBytes,
    state.lockRecord.repositoryKey,
    state.lockRecord.pipeName,
  );
  if (!lockBytes.equals(state.lockBytes)) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_LOCK_INVALID',
      'Native build lock evidence is invalid.',
    );
  }
  emitDiagnosticPhase(state.diagnosticControl ?? null, 'LOCK_READBACK_DONE');
  await assertAbsent(state.paths.disposition, true);
  emitDiagnosticPhase(
    state.diagnosticControl ?? null,
    'RETENTION_DISPOSITION_ABSENT',
  );

  await assertAbsent(state.paths.artifact, true);
  emitDiagnosticPhase(
    state.diagnosticControl ?? null,
    'RETENTION_ARTIFACT_ABSENT',
  );
  await assertAbsent(state.paths.receipt, true);
  emitDiagnosticPhase(
    state.diagnosticControl ?? null,
    'RETENTION_RECEIPT_ABSENT',
  );
  appendCarrierJournal(state, 'retention:prepared');
  if (state[RETENTION_PLAN_TEST_ERROR] instanceof NativeBuildError) {
    const injected = state[RETENTION_PLAN_TEST_ERROR];
    state[RETENTION_PLAN_TEST_ERROR] = null;
    throw injected;
  }
  emitDiagnosticPhase(state.diagnosticControl ?? null, 'RETENTION_PREPARED');
  return Object.freeze({
    staging,
    lock: Object.freeze({
      target: state.paths.lock,
      identity: state.lockIdentity,
    }),
  });
}

async function runProbe(addonPath, probePath) {
  const request = canonicalJson({
    requestFormat: 'moxley-native-build-probe',
    requestVersion: 1,
    addonPath,
    probePath,
  });
  const result = await requireProcessSuccess(
    'Native addon probe',
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
  if (result.stderr.length !== 0) {
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

async function closeLeaseOnce(state, suppressFailure = false) {
  if (state.lease === null) return;
  emitDiagnosticPhase(state.diagnosticControl ?? null, 'LEASE_CLOSE_BEGIN');
  const lease = state.lease;
  state.lease = null;
  const timeoutError = leaseCloseTimedOutError();
  let timer = null;
  const closePromise = Promise.resolve().then(() => lease.close());
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(timeoutError), LEASE_CLOSE_TIMEOUT_MS);
  });
  try {
    await Promise.race([closePromise, timeoutPromise]);
  } catch (error) {
    const timedOut = error === timeoutError;
    appendCarrierJournal(
      state,
      timedOut ? 'lease:close-timeout' : 'lease:close-rejected',
    );
    emitDiagnosticPhase(
      state.diagnosticControl ?? null,
      timedOut ? 'LEASE_CLOSE_TIMEOUT' : 'LEASE_CLOSE_REJECTED',
    );
    try {
      emitDiagnosticPhase(
        state.diagnosticControl ?? null,
        'LEASE_ABANDON_CALLED',
      );
      Promise.resolve(lease.abandon()).catch(() => {});
    } catch {}
    if (!suppressFailure) throw error;
    return;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
  appendCarrierJournal(state, 'lease:close');
  emitDiagnosticPhase(state.diagnosticControl ?? null, 'LEASE_CLOSE_DONE');
}

async function publishTerminalDisposition(
  state,
  disposition,
  reason,
  causeReason,
  testControl = null,
) {
  emitDiagnosticPhase(state.diagnosticControl ?? null, 'DISPOSITION_BEGIN');
  const record = createDispositionRecord(
    state.lockRecord,
    disposition,
    reason,
    causeReason,
  );
  const bytes = Buffer.from(canonicalJson(record), 'utf8');
  decodeDispositionBytes(bytes, state.lockRecord);
  state.expectedDispositionRecord = record;
  state.expectedDispositionBytes = bytes;
  const result = await writeOnceCarrier({
    state,
    carrier: 'disposition',
    target: state.paths.disposition,
    parent: state.paths.release,
    parentIdentity: state.releaseIdentity,
    bytes,
    expectedKey: state.lockRecord.repositoryKey,
    expectedPipe: state.lockRecord.pipeName,
    lock: state.lockRecord,
    testControl,
  });
  state.dispositionIdentity = result.identity;
  state.dispositionRecord = result.record;
  state.dispositionBytes = result.bytes;
  state.dispositionAcknowledged = true;
  emitDiagnosticPhase(
    state.diagnosticControl ?? null,
    'DISPOSITION_ACKNOWLEDGED',
  );
  return result;
}

async function deferBeforePromotion(state) {
  await assertAbsent(state.paths.artifact, true);
  emitDiagnosticPhase(
    state.diagnosticControl ?? null,
    'DEFERRAL_ARTIFACT_ABSENT',
  );
  await assertAbsent(state.paths.receipt, true);
  emitDiagnosticPhase(
    state.diagnosticControl ?? null,
    'DEFERRAL_RECEIPT_ABSENT',
  );
  emitDiagnosticPhase(state.diagnosticControl ?? null, 'DEFERRAL_THROW');
  throw physicalCleanupDeferredError();
}

function throwOriginalBuildError(state, originalError) {
  emitDiagnosticPhase(
    state.diagnosticControl ?? null,
    'ORIGINAL_ERROR_RETHROWN',
  );
  throw originalError;
}

async function handleBuildFailure(state, originalError) {
  const activeLock =
    state.lockOwned &&
    state.lockPublication === 'ACTIVE_VERIFIED' &&
    state.lockRecord !== null &&
    state.lockBytes !== null;
  if (!activeLock) {
    await closeLeaseOnce(state, true);
    throwOriginalBuildError(state, originalError);
  }

  if (isTerminationUnconfirmed(originalError)) {
    try {
      await publishTerminalDisposition(
        state,
        'TERMINATION_UNCONFIRMED',
        originalError.reason,
        originalError.cause?.reason ?? null,
        state[TERMINAL_CARRIER_TEST_CONTROL] ?? null,
      );
    } catch {}
    await closeLeaseOnce(state, true);
    throwOriginalBuildError(state, originalError);
  }

  emitDiagnosticPhase(state.diagnosticControl ?? null, 'RETENTION_BEGIN');
  try {
    await prepareRetentionPlan(state);
  } catch (retentionError) {
    if (isTerminationUnconfirmed(retentionError)) {
      try {
        await publishTerminalDisposition(
          state,
          'TERMINATION_UNCONFIRMED',
          retentionError.reason,
          retentionError.cause?.reason ?? null,
          state[TERMINAL_CARRIER_TEST_CONTROL] ?? null,
        );
      } catch {}
    }
    await closeLeaseOnce(state, true);
    throwOriginalBuildError(state, originalError);
  }

  try {
    await publishTerminalDisposition(
      state,
      'CLEAN_AUTHORIZED',
      null,
      null,
      state[TERMINAL_CARRIER_TEST_CONTROL] ?? null,
    );
  } catch {
    await closeLeaseOnce(state, true);
    throwOriginalBuildError(state, originalError);
  }

  await closeLeaseOnce(state, true);
  throwOriginalBuildError(state, originalError);
}

async function runBuildWithDiagnosticControl(diagnosticControl) {
  diagnosticControlState(diagnosticControl, true);
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
      LOCK_RELATIVE ||
    path.relative(inputs.canonicalRoot, paths.disposition).split(path.sep).join('/') !==
      DISPOSITION_RELATIVE
  ) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_PATH_INVALID',
      'Exact package-relative native build paths did not authenticate.',
    );
  }
  const directoryPreflight = await preflightBuildDirectories(
    inputs.canonicalRoot,
    paths,
  );
  await assertBuildCollisionPathsAbsent(paths);

  const state = {
    paths,
    lease: null,
    lockOwned: false,
    lockPublication: 'ABSENT',
    lockIdentity: null,
    lockRecord: null,
    lockBytes: null,
    dispositionCreated: false,
    dispositionIdentity: null,
    dispositionRecord: null,
    dispositionBytes: null,
    dispositionAcknowledged: false,
    expectedDispositionRecord: null,
    expectedDispositionBytes: null,
    releaseIdentity: null,
    stagingCreated: false,
    stagingIdentity: null,
    allowedStagingNames: new Set(STAGING_FILE_NAMES),
    journal: null,
    diagnosticControl,
  };
  try {
    state.lease = await startLease(inputs.pipeName);
    const directories = await establishBuildDirectoriesLocally(
      inputs.canonicalRoot,
      paths,
      directoryPreflight,
    );
    state.releaseIdentity = directories.releaseIdentity;
    const lockRecord = createV2LockRecord(
      inputs.repositoryKey,
      inputs.pipeName,
      stagingName,
      nonce,
    );
    validateV2LockRecord(lockRecord, inputs.repositoryKey, inputs.pipeName);
    const lockBytes = Buffer.from(canonicalJson(lockRecord), 'utf8');
    decodeV2LockBytes(lockBytes, inputs.repositoryKey, inputs.pipeName);
    await acquireV2Lock(state, lockRecord, lockBytes);
    await assertBuildCollisionPathsAbsent(paths);

    await createOwnedStagingDirectory(state);
    await fsp.writeFile(paths.probeFile, 'moxley-native-build-probe\n', {
      encoding: 'utf8',
      flag: 'wx',
    });
    await compileProductionAddon(paths, inputs.toolchain);
    await authenticateStagingDirectory(state);
    await runProbe(paths.stagedAddon, paths.probeFile);
    const expected = await writeReceipt(paths, inputs.toolchain);
    emitDiagnosticPhase(diagnosticControl, 'RECEIPT_DONE');
    emitDiagnosticPhase(diagnosticControl, 'STAGING_AUTH_2_BEGIN');
    await authenticateStagingDirectory(state, true);
    emitDiagnosticPhase(diagnosticControl, 'STAGING_AUTH_2_DONE');

    validateReceipt(expected.receipt);
    emitDiagnosticPhase(diagnosticControl, 'RECEIPT_VALIDATED');
    emitDiagnosticPhase(diagnosticControl, 'DEFERRAL_CALLED');
    return await deferBeforePromotion(state);
  } catch (error) {
    emitDiagnosticPhase(diagnosticControl, 'RUNBUILD_CATCH_ENTERED');
    return handleBuildFailure(state, error);
  }
}

function runBuild() {
  return runBuildWithDiagnosticControl(null);
}

function runBuildForDiagnostic(diagnosticControl) {
  diagnosticControlState(diagnosticControl);
  return runBuildWithDiagnosticControl(diagnosticControl);
}

async function readExistingBytes(target) {
  try {
    return await fsp.readFile(target);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function exerciseCarrierScenario(sandboxRoot, scenario) {
  const tempRoot = await fsp.realpath(os.tmpdir());
  const canonicalSandbox = await fsp.realpath(sandboxRoot);
  if (
    path.dirname(canonicalSandbox).toLowerCase() !== tempRoot.toLowerCase() ||
    !path.basename(canonicalSandbox).startsWith('moxley-native-build-test-') ||
    scenario === null ||
    typeof scenario !== 'object' ||
    !exactKeys(scenario, ['disposition', 'fault']) ||
    !['CLEAN_AUTHORIZED', 'TERMINATION_UNCONFIRMED'].includes(
      scenario.disposition,
    ) ||
    !CARRIER_FAULTS.includes(scenario.fault)
  ) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_TEST_SCOPE_INVALID',
      'Injected native build test scope is invalid.',
    );
  }

  const stagingName = `${STAGING_PREFIX}${'a'.repeat(32)}`;
  const key = repositoryKey(canonicalSandbox);
  const pipeName = pipeNameForKey(key);
  const paths = packagePaths(canonicalSandbox, stagingName);
  await fsp.mkdir(paths.build, { recursive: false });
  await fsp.mkdir(paths.release, { recursive: false });
  const releaseMetadata = await fsp.lstat(paths.release, { bigint: true });
  let leaseClosed = false;
  const state = {
    paths,
    lease: {
      async close() {
        leaseClosed = true;
      },
    },
    lockOwned: false,
    lockPublication: 'ABSENT',
    lockIdentity: null,
    lockRecord: null,
    lockBytes: null,
    dispositionCreated: false,
    dispositionIdentity: null,
    dispositionRecord: null,
    dispositionBytes: null,
    dispositionAcknowledged: false,
    expectedDispositionRecord: null,
    expectedDispositionBytes: null,
    releaseIdentity: identityOf(releaseMetadata),
    stagingCreated: false,
    stagingIdentity: null,
    allowedStagingNames: new Set(['moxley-windows-reparse.obj']),
    journal: [],
  };
  const lockRecord = createV2LockRecord(
    key,
    pipeName,
    stagingName,
    'b'.repeat(32),
  );
  const lockBytes = Buffer.from(canonicalJson(lockRecord), 'utf8');
  await acquireV2Lock(state, lockRecord, lockBytes);

  await fsp.mkdir(paths.staging, { recursive: false });
  const stagingMetadata = await fsp.lstat(paths.staging, { bigint: true });
  state.stagingCreated = true;
  state.stagingIdentity = identityOf(stagingMetadata);
  await fsp.writeFile(paths.object, 'object', { flag: 'wx' });

  const originalError =
    scenario.disposition === 'TERMINATION_UNCONFIRMED'
      ? terminationUnconfirmedError(
          SUBPROCESS_REASONS.TERMINATION_NOT_CONFIRMED,
          SUBPROCESS_REASONS.TIMEOUT,
        )
      : buildError(
          'MOXLEY_NATIVE_BUILD_INJECTED_FAILURE',
          'Injected native build failure.',
        );
  const control = Object.freeze({
    token: CARRIER_TEST_CONTROL_TOKEN,
    fault: scenario.fault,
  });
  state[TERMINAL_CARRIER_TEST_CONTROL] = control;
  let returnedError;
  try {
    await handleBuildFailure(state, originalError);
  } catch (error) {
    returnedError = error;
  }
  if (returnedError === undefined) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_TEST_FAILED',
      'Injected native build scenario did not terminate.',
    );
  }

  const actualLockBytes = await readExistingBytes(paths.lock);
  const actualDispositionBytes = await readExistingBytes(paths.disposition);
  let decodedDisposition = null;
  if (actualDispositionBytes !== null) {
    try {
      decodedDisposition = decodeDispositionBytes(
        actualDispositionBytes,
        lockRecord,
      );
    } catch {}
  }
  return Object.freeze({
    scenario: Object.freeze({ ...scenario }),
    paths,
    acknowledged: state.dispositionAcknowledged,
    originalErrorPreserved: returnedError === originalError,
    originalError: Object.freeze({
      code: originalError.code,
      message: originalError.message,
      reason: originalError.reason ?? null,
      causeReason: originalError.cause?.reason ?? null,
    }),
    lock: Object.freeze({
      exists: actualLockBytes !== null,
      bytes:
        actualLockBytes === null ? null : actualLockBytes.toString('utf8'),
      record: Object.freeze({ ...lockRecord }),
    }),
    sidecar: Object.freeze({
      exists: actualDispositionBytes !== null,
      bytes:
        actualDispositionBytes === null
          ? null
          : actualDispositionBytes.toString('utf8'),
      decoded:
        decodedDisposition === null
          ? null
          : Object.freeze({ ...decodedDisposition }),
    }),
    retained: Object.freeze({
      staging: await exists(paths.staging),
      artifact: await exists(paths.artifact),
      receipt: await exists(paths.receipt),
    }),
    leaseClosed,
    journal: Object.freeze([...state.journal]),
  });
}

async function exerciseRetentionScenario(sandboxRoot, mode) {
  const tempRoot = await fsp.realpath(os.tmpdir());
  const canonicalSandbox = await fsp.realpath(sandboxRoot);
  const acceptedModes = [
    'pre-lock-failure',
    'termination-unconfirmed-pre-lock',
    'staging-creation-collision',
    'staging-authentication-failure',
    'compiler-failure',
    'linker-failure',
    'probe-failure',
    'retention-plan-authentication-failure',
    'termination-unconfirmed',
    'normal-deferral',
    'lease-close-rejected',
    'lease-close-timeout',
    'lock-collision',
    'sidecar-collision-post-lock',
    ...CARRIER_FAULTS.filter((fault) => fault !== 'none').map(
      (fault) => `lock-publication-${fault}`,
    ),
    ...CARRIER_FAULTS.filter((fault) => fault !== 'none').map(
      (fault) => `terminal-publication-${fault}`,
    ),
  ];
  if (
    path.dirname(canonicalSandbox).toLowerCase() !== tempRoot.toLowerCase() ||
    !path.basename(canonicalSandbox).startsWith('moxley-native-build-test-') ||
    !acceptedModes.includes(mode)
  ) {
    throw buildError(
      'MOXLEY_NATIVE_BUILD_TEST_SCOPE_INVALID',
      'Injected native build test scope is invalid.',
    );
  }

  const release = path.join(canonicalSandbox, 'Release');
  const stagingName = `${STAGING_PREFIX}${'a'.repeat(32)}`;
  const paths = {
    release,
    staging: path.join(release, stagingName),
    stagedAddon: path.join(
      release,
      stagingName,
      'moxley-windows-reparse.node',
    ),
    stagedReceipt: path.join(
      release,
      stagingName,
      'moxley-windows-reparse.receipt.json',
    ),
    object: path.join(
      release,
      stagingName,
      'moxley-windows-reparse.obj',
    ),
    compileResponse: path.join(
      release,
      stagingName,
      'moxley-windows-reparse-compile.rsp',
    ),
    linkResponse: path.join(
      release,
      stagingName,
      'moxley-windows-reparse-link.rsp',
    ),
    probeFile: path.join(
      release,
      stagingName,
      'moxley-windows-reparse-probe.txt',
    ),
    artifact: path.join(release, 'moxley-windows-reparse.node'),
    receipt: path.join(release, 'moxley-windows-reparse.receipt.json'),
    lock: path.join(release, '.moxley-windows-reparse-build.lock'),
    disposition: path.join(
      release,
      '.moxley-windows-reparse-build.disposition.json',
    ),
  };
  await fsp.mkdir(release, { recursive: false });
  const releaseMetadata = await fsp.lstat(release, { bigint: true });
  const key = repositoryKey(canonicalSandbox);
  const pipeName = pipeNameForKey(key);
  let leaseClosed = false;
  let leaseAbandonCount = 0;
  let leaseAbandoned = false;
  const leaseCloseError = new Error('Injected lease close rejection.');
  const state = {
    paths,
    lease: {
      async close() {
        if (mode === 'lease-close-rejected') throw leaseCloseError;
        if (mode === 'lease-close-timeout') return new Promise(() => {});
        leaseClosed = true;
      },
      abandon() {
        if (leaseAbandoned) return;
        leaseAbandoned = true;
        leaseAbandonCount += 1;
      },
    },
    lockOwned: false,
    lockPublication: 'ABSENT',
    lockIdentity: null,
    lockRecord: null,
    lockBytes: null,
    dispositionCreated: false,
    dispositionIdentity: null,
    dispositionRecord: null,
    dispositionBytes: null,
    dispositionAcknowledged: false,
    expectedDispositionRecord: null,
    expectedDispositionBytes: null,
    releaseIdentity: identityOf(releaseMetadata),
    stagingCreated: false,
    stagingIdentity: null,
    allowedStagingNames: new Set(['moxley-windows-reparse.obj']),
    journal: [],
  };
  const lockRecord = createV2LockRecord(
    key,
    pipeName,
    stagingName,
    'b'.repeat(32),
  );
  const lockBytes = Buffer.from(canonicalJson(lockRecord), 'utf8');

  async function resultFor(triggeringError, caught) {
    const actualLockBytes = await readExistingBytes(paths.lock);
    const dispositionBytes = await readExistingBytes(paths.disposition);
    let disposition = null;
    if (dispositionBytes !== null) {
      try {
        disposition = decodeDispositionBytes(dispositionBytes, lockRecord);
      } catch {}
    }
    return Object.freeze({
      mode,
      paths: Object.freeze(paths),
      failed: true,
      code: caught.code,
      triggeringCode: triggeringError.code,
      triggeringError,
      caught,
      originalErrorPreserved: caught === triggeringError,
      leaseCloseError,
      leaseClosed,
      leaseAbandonCount,
      lock: Object.freeze({
        exists: actualLockBytes !== null,
        bytes:
          actualLockBytes === null ? null : actualLockBytes.toString('utf8'),
      }),
      disposition:
        disposition === null ? null : Object.freeze({ ...disposition }),
      dispositionBytes:
        dispositionBytes === null ? null : dispositionBytes.toString('utf8'),
      retained: Object.freeze({
        staging: await exists(paths.staging),
        artifact: await exists(paths.artifact),
        receipt: await exists(paths.receipt),
      }),
      journal: Object.freeze([...state.journal]),
    });
  }

  async function handle(triggeringError) {
    let caught;
    try {
      await handleBuildFailure(state, triggeringError);
    } catch (error) {
      caught = error;
    }
    if (caught === undefined) {
      throw buildError(
        'MOXLEY_NATIVE_BUILD_TEST_FAILED',
        'Injected native build scenario did not terminate.',
      );
    }
    return resultFor(triggeringError, caught);
  }

  if (mode === 'pre-lock-failure' || mode === 'termination-unconfirmed-pre-lock') {
    const triggeringError =
      mode === 'termination-unconfirmed-pre-lock'
        ? terminationUnconfirmedError(
            SUBPROCESS_REASONS.TERMINATION_NOT_CONFIRMED,
            SUBPROCESS_REASONS.TIMEOUT,
          )
        : buildError(
            'MOXLEY_NATIVE_BUILD_INJECTED_FAILURE',
            'Injected pre-lock failure.',
          );
    return handle(triggeringError);
  }

  if (mode === 'lock-collision') {
    await fsp.writeFile(paths.lock, 'preexisting-lock\n', { flag: 'wx' });
    let triggeringError;
    try {
      await acquireV2Lock(state, lockRecord, lockBytes);
    } catch (error) {
      triggeringError = error;
    }
    return handle(triggeringError);
  }

  if (mode.startsWith('lock-publication-')) {
    const fault = mode.slice('lock-publication-'.length);
    const control = Object.freeze({
      token: CARRIER_TEST_CONTROL_TOKEN,
      fault,
    });
    let triggeringError;
    try {
      await acquireV2Lock(state, lockRecord, lockBytes, control);
    } catch (error) {
      triggeringError = error;
    }
    return handle(triggeringError);
  }

  await acquireV2Lock(state, lockRecord, lockBytes);

  if (mode === 'sidecar-collision-post-lock') {
    await fsp.writeFile(paths.disposition, 'preexisting-sidecar\n', {
      flag: 'wx',
    });
    return handle(
      buildError(
        'MOXLEY_NATIVE_BUILD_COLLISION',
        'Generated native output already exists; run explicit clean.',
      ),
    );
  }

  let triggeringError = null;
  if (mode === 'staging-creation-collision') {
    await fsp.mkdir(paths.staging, { recursive: false });
    try {
      await createOwnedStagingDirectory(state);
    } catch (error) {
      triggeringError = error;
    }
  } else {
    if (mode === 'staging-authentication-failure') {
      state[STAGING_AUTH_TEST_ERROR] = buildError(
        'MOXLEY_NATIVE_BUILD_STAGE_INVALID',
        'Native build staging identity changed.',
      );
    }
    try {
      await createOwnedStagingDirectory(state);
    } catch (error) {
      triggeringError = error;
    }
  }

  if (triggeringError === null) {
    await fsp.writeFile(paths.object, 'object', { flag: 'wx' });
    const failures = Object.freeze({
      'compiler-failure': buildError(
        'MOXLEY_NATIVE_BUILD_SUBPROCESS_FAILED',
        'Injected compiler failure.',
      ),
      'linker-failure': buildError(
        'MOXLEY_NATIVE_BUILD_SUBPROCESS_FAILED',
        'Injected linker failure.',
      ),
      'probe-failure': buildError(
        'MOXLEY_NATIVE_BUILD_PROBE_FAILED',
        'Injected staged probe failure.',
      ),
      'retention-plan-authentication-failure': buildError(
        'MOXLEY_NATIVE_BUILD_INJECTED_FAILURE',
        'Injected failure before retention authentication.',
      ),
      'termination-unconfirmed': terminationUnconfirmedError(
        SUBPROCESS_REASONS.TERMINATION_NOT_CONFIRMED,
        SUBPROCESS_REASONS.TIMEOUT,
      ),
      'normal-deferral': physicalCleanupDeferredError(),
      'lease-close-rejected': physicalCleanupDeferredError(),
      'lease-close-timeout': physicalCleanupDeferredError(),
    });
    triggeringError =
      failures[mode] ??
      buildError(
        'MOXLEY_NATIVE_BUILD_INJECTED_FAILURE',
        'Injected terminal publication failure.',
      );
  }

  if (mode === 'retention-plan-authentication-failure') {
    state[RETENTION_PLAN_TEST_ERROR] = buildError(
      'MOXLEY_NATIVE_BUILD_STAGE_INVALID',
      'Native build retained state could not be authenticated.',
    );
  }
  if (mode.startsWith('terminal-publication-')) {
    state[TERMINAL_CARRIER_TEST_CONTROL] = Object.freeze({
      token: CARRIER_TEST_CONTROL_TOKEN,
      fault: mode.slice('terminal-publication-'.length),
    });
  }
  return handle(triggeringError);
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
  DISPOSITION_RELATIVE,
  LOCK_RELATIVE,
  MAX_CARRIER_BYTES,
  PACKAGE_ROOT,
  RECEIPT_RELATIVE,
  STAGING_FILE_NAMES,
  STAGING_PREFIX,
  assertAbsent,
  assertNoReparse,
  authenticatePath,
  canonicalJson,
  classifyLockCarrierBytes,
  createLockRecord,
  createDispositionRecord,
  createV2LockRecord,
  decodeCanonicalJson,
  decodeDispositionBytes,
  decodeLockBytes,
  decodeV2LockBytes,
  exists,
  exactKeys,
  formatDiagnostic,
  identityOf,
  inventoryStagingTree,
  isStrictDescendant,
  ordinalCompare,
  packagePaths,
  pipeNameForKey,
  readBoundedCarrier,
  repositoryKey,
  sameIdentity,
  sameWindowsPath,
  sha256,
  validateLockRecord,
  validateV2LockRecord,
});

module.exports = Object.freeze({
  internal,
  __test: Object.freeze({
    AUTHENTICATION_TIMEOUT_MS,
    DIAGNOSTIC_PHASES,
    EXIT_CLOSE_GRACE_MS,
    LEASE_CLOSE_TIMEOUT_MS,
    MAX_ACTIVE_OBJECTS,
    MAX_ACTIVE_TYPES,
    MAX_DIAGNOSTIC_OUTPUT_BYTES,
    MAX_DIAGNOSTIC_RECORD_BYTES,
    MAX_DIAGNOSTIC_RECORDS,
    MAX_PROCESS_OUTPUT_BYTES,
    POST_TERMINATION_GRACE_MS,
    PROCESS_TIMEOUT_MS,
    PROBE_TIMEOUT_MS,
    TASKKILL_TIMEOUT_MS,
    authenticateBuildInputs,
    authenticateHost,
    authenticateRegularFile,
    captureActiveEvidence,
    compareActiveEvidence,
    createActiveDeltaEvidence,
    createDiagnosticControl,
    createReceipt,
    decodeReceiptBytes,
    emitDiagnosticPhase,
    exerciseCarrierScenario,
    exerciseRetentionScenario,
    parseDiagnosticPhaseStream,
    requireProcessSuccess: requireProcessSuccessForTest,
    repositoryLeaseIdentity,
    runBuild,
    runBuildForDiagnostic,
    runProcess: runProcessForTest,
    sanitizeActiveObjects,
    supervisorFailureSnapshot,
    validateActiveDeltaEvidence,
    validateReceipt,
    validateSupervisorFailureSnapshot,
    validateHostEvidence,
    validateNodeRuntimeInputs,
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
