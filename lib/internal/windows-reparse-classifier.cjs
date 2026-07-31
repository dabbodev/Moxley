'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { TextDecoder, types } = require('node:util');

const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');
const RECEIPT_RELATIVE =
  'build/Release/moxley-windows-reparse.receipt.json';
const ARTIFACT_RELATIVE =
  'build/Release/moxley-windows-reparse.node';
const RECEIPT_PATH = path.join(PACKAGE_ROOT, ...RECEIPT_RELATIVE.split('/'));
const ARTIFACT_PATH = path.join(PACKAGE_ROOT, ...ARTIFACT_RELATIVE.split('/'));
const SOURCE_RELATIVE = 'native/windows-reparse-classifier.c';
const MAX_RECEIPT_BYTES = 16 * 1024;
const UINT32_MAX = 0xffffffff;
const FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400;
const HEX_64 = /^[0-9a-f]{64}$/;

const RECEIPT_KEYS = Object.freeze([
  'receiptFormat',
  'receiptVersion',
  'nativeContractVersion',
  'target',
  'source',
  'toolchain',
  'artifact',
]);
const RESULT_KEYS = Object.freeze([
  'outcome',
  'fileAttributes',
  'reparseTag',
  'win32Error',
  'closeWin32Error',
]);

const ERROR_DETAILS = Object.freeze({
  MOXLEY_NATIVE_PLATFORM_UNSUPPORTED:
    'Native classifier is unsupported on this platform.',
  MOXLEY_NATIVE_ARTIFACT_MISSING:
    'Native classifier artifact is missing.',
  MOXLEY_NATIVE_RECEIPT_INVALID:
    'Native classifier receipt is invalid.',
  MOXLEY_NATIVE_INTEGRITY_MISMATCH:
    'Native classifier artifact integrity check failed.',
  MOXLEY_NATIVE_LOAD_FAILED:
    'Native classifier failed to load.',
  MOXLEY_NATIVE_EXPORT_INVALID:
    'Native classifier export is invalid.',
  MOXLEY_NATIVE_RESULT_INVALID:
    'Native classifier returned invalid result evidence.',
});

class MoxleyNativeCapabilityError extends Error {
  constructor(code, cause) {
    if (cause === undefined) {
      super(ERROR_DETAILS[code]);
    } else {
      super(ERROR_DETAILS[code], { cause });
    }
    this.name = 'MoxleyNativeCapabilityError';
    this.code = code;
  }
}

function capabilityError(code, cause) {
  return new MoxleyNativeCapabilityError(code, cause);
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value)) === JSON.stringify(keys)
  );
}

function positiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validSha256(value) {
  return typeof value === 'string' && HEX_64.test(value);
}

function readReceiptBytes() {
  let metadata;
  try {
    metadata = fs.lstatSync(RECEIPT_PATH);
  } catch (error) {
    if (error !== null && error.code === 'ENOENT') {
      throw capabilityError('MOXLEY_NATIVE_ARTIFACT_MISSING', error);
    }
    throw capabilityError('MOXLEY_NATIVE_RECEIPT_INVALID', error);
  }

  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    !positiveSafeInteger(metadata.size) ||
    metadata.size > MAX_RECEIPT_BYTES
  ) {
    throw capabilityError('MOXLEY_NATIVE_RECEIPT_INVALID');
  }

  let bytes;
  try {
    bytes = fs.readFileSync(RECEIPT_PATH);
  } catch (error) {
    if (error !== null && error.code === 'ENOENT') {
      throw capabilityError('MOXLEY_NATIVE_ARTIFACT_MISSING', error);
    }
    throw capabilityError('MOXLEY_NATIVE_RECEIPT_INVALID', error);
  }

  if (bytes.length !== metadata.size) {
    throw capabilityError('MOXLEY_NATIVE_RECEIPT_INVALID');
  }
  return bytes;
}

function decodeReceipt(bytes) {
  if (
    bytes.length === 0 ||
    bytes.length > MAX_RECEIPT_BYTES ||
    (bytes.length >= 3 &&
      bytes[0] === 0xef &&
      bytes[1] === 0xbb &&
      bytes[2] === 0xbf)
  ) {
    throw capabilityError('MOXLEY_NATIVE_RECEIPT_INVALID');
  }

  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw capabilityError('MOXLEY_NATIVE_RECEIPT_INVALID', error);
  }

  if (
    !text.endsWith('\n') ||
    text.slice(0, -1).includes('\n') ||
    text.includes('\r')
  ) {
    throw capabilityError('MOXLEY_NATIVE_RECEIPT_INVALID');
  }

  let receipt;
  try {
    receipt = JSON.parse(text.slice(0, -1));
  } catch (error) {
    throw capabilityError('MOXLEY_NATIVE_RECEIPT_INVALID', error);
  }

  validateReceipt(receipt);
  if (!Buffer.from(`${JSON.stringify(receipt)}\n`, 'utf8').equals(bytes)) {
    throw capabilityError('MOXLEY_NATIVE_RECEIPT_INVALID');
  }
  return receipt;
}

function validateReceipt(receipt) {
  const runningNodeApi = Number(process.versions.napi);
  if (
    !exactKeys(receipt, RECEIPT_KEYS) ||
    receipt.receiptFormat !== 'moxley-native-build-receipt' ||
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
    receipt.target.nodeVersion !== process.version ||
    receipt.target.nodeApiVersion !== 8 ||
    !Number.isSafeInteger(runningNodeApi) ||
    runningNodeApi < 8 ||
    !exactKeys(receipt.source, ['path', 'byteLength', 'sha256']) ||
    receipt.source.path !== SOURCE_RELATIVE ||
    !positiveSafeInteger(receipt.source.byteLength) ||
    !validSha256(receipt.source.sha256) ||
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
    receipt.toolchain.msvcVersion !== '14.44.35207' ||
    receipt.toolchain.compilerVersion !== '19.44.35228.0' ||
    receipt.toolchain.linkerVersion !== '14.44.35228.0' ||
    receipt.toolchain.windowsSdkVersion !== '10.0.26100.0' ||
    !validSha256(receipt.toolchain.nodeHeadersTreeSha256) ||
    receipt.toolchain.nodeImportLibraryByteLength !== 2_869_366 ||
    receipt.toolchain.nodeImportLibrarySha256 !==
      'be205f2934c17fbd56ce6cdfcfbeb2f6a85061d5141e7a58eba240a8477a12fd' ||
    receipt.toolchain.kernel32ImportLibraryByteLength !== 311_908 ||
    receipt.toolchain.kernel32ImportLibrarySha256 !==
      '341c7d56125a03b458e4d5093e4c79b33123ccfdfd610fe236937b8e6f3134bb' ||
    !exactKeys(receipt.artifact, ['path', 'byteLength', 'sha256']) ||
    receipt.artifact.path !== ARTIFACT_RELATIVE ||
    !positiveSafeInteger(receipt.artifact.byteLength) ||
    !validSha256(receipt.artifact.sha256)
  ) {
    throw capabilityError('MOXLEY_NATIVE_RECEIPT_INVALID');
  }
}

function authenticateArtifact(receipt) {
  let metadata;
  try {
    metadata = fs.lstatSync(ARTIFACT_PATH);
  } catch (error) {
    if (error !== null && error.code === 'ENOENT') {
      throw capabilityError('MOXLEY_NATIVE_ARTIFACT_MISSING', error);
    }
    throw capabilityError('MOXLEY_NATIVE_INTEGRITY_MISMATCH', error);
  }

  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    !positiveSafeInteger(metadata.size) ||
    metadata.size !== receipt.artifact.byteLength
  ) {
    throw capabilityError('MOXLEY_NATIVE_INTEGRITY_MISMATCH');
  }

  let bytes;
  try {
    bytes = fs.readFileSync(ARTIFACT_PATH);
  } catch (error) {
    if (error !== null && error.code === 'ENOENT') {
      throw capabilityError('MOXLEY_NATIVE_ARTIFACT_MISSING', error);
    }
    throw capabilityError('MOXLEY_NATIVE_INTEGRITY_MISMATCH', error);
  }

  let digest;
  try {
    digest = createHash('sha256').update(bytes).digest('hex');
  } catch (error) {
    throw capabilityError('MOXLEY_NATIVE_INTEGRITY_MISMATCH', error);
  }

  if (
    bytes.length !== metadata.size ||
    digest !== receipt.artifact.sha256
  ) {
    throw capabilityError('MOXLEY_NATIVE_INTEGRITY_MISMATCH');
  }
}

function loadAddon() {
  let addon;
  try {
    addon = require(ARTIFACT_PATH);
  } catch (error) {
    throw capabilityError('MOXLEY_NATIVE_LOAD_FAILED', error);
  }

  let keys;
  let descriptor;
  try {
    if (
      addon === null ||
      typeof addon !== 'object' ||
      types.isProxy(addon) ||
      Array.isArray(addon)
    ) {
      throw capabilityError('MOXLEY_NATIVE_EXPORT_INVALID');
    }
    keys = Reflect.ownKeys(addon);
    if (keys.length !== 1 || keys[0] !== 'classify') {
      throw capabilityError('MOXLEY_NATIVE_EXPORT_INVALID');
    }
    descriptor = Reflect.getOwnPropertyDescriptor(addon, 'classify');
  } catch (error) {
    if (error instanceof MoxleyNativeCapabilityError) {
      throw error;
    }
    throw capabilityError('MOXLEY_NATIVE_EXPORT_INVALID', error);
  }

  if (
    descriptor === undefined ||
    !Object.hasOwn(descriptor, 'value') ||
    typeof descriptor.value !== 'function'
  ) {
    throw capabilityError('MOXLEY_NATIVE_EXPORT_INVALID');
  }
  return descriptor.value;
}

function resultError(reason) {
  return capabilityError(
    'MOXLEY_NATIVE_RESULT_INVALID',
    new TypeError(reason),
  );
}

function inspectResult(result) {
  if (
    result === null ||
    typeof result !== 'object' ||
    types.isProxy(result) ||
    Array.isArray(result)
  ) {
    return { reason: 'RESULT_NOT_OBJECT' };
  }

  let prototype;
  let keys;
  const descriptors = [];
  try {
    prototype = Object.getPrototypeOf(result);
    keys = Reflect.ownKeys(result);
    for (const key of RESULT_KEYS) {
      descriptors.push(Reflect.getOwnPropertyDescriptor(result, key));
    }
  } catch {
    return { reason: 'RESULT_INSPECTION_FAILED' };
  }

  if (prototype !== Object.prototype) {
    return { reason: 'RESULT_NOT_OBJECT' };
  }
  if (
    keys.length !== RESULT_KEYS.length ||
    keys.some((key, index) => key !== RESULT_KEYS[index])
  ) {
    return { reason: 'RESULT_KEY_SET_INVALID' };
  }

  const values = [];
  for (const descriptor of descriptors) {
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      return { reason: 'RESULT_DESCRIPTOR_INVALID' };
    }
    values.push(descriptor.value);
  }

  const [outcome, fileAttributes, reparseTag, win32Error, closeWin32Error] =
    values;
  if (
    !['ordinary', 'reparse', 'capability-gap'].includes(outcome) ||
    ![fileAttributes, reparseTag, win32Error, closeWin32Error].every(
      (value) =>
        typeof value === 'number' &&
        Number.isFinite(value) &&
        Number.isInteger(value) &&
        value >= 0 &&
        value <= UINT32_MAX,
    )
  ) {
    return { reason: 'RESULT_FIELD_INVALID' };
  }

  const hasReparseAttribute =
    (fileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) !== 0;
  const consistent =
    (outcome === 'ordinary' &&
      !hasReparseAttribute &&
      reparseTag === 0 &&
      win32Error === 0 &&
      closeWin32Error === 0) ||
    (outcome === 'reparse' &&
      hasReparseAttribute &&
      win32Error === 0 &&
      closeWin32Error === 0) ||
    (outcome === 'capability-gap' &&
      (win32Error !== 0 || closeWin32Error !== 0));
  if (!consistent) {
    return { reason: 'RESULT_OUTCOME_INCONSISTENT' };
  }

  return {
    accepted: Object.freeze({
      outcome,
      fileAttributes,
      reparseTag,
      win32Error,
      closeWin32Error,
    }),
  };
}

function createWrapper(nativeClassify) {
  let poisonReason = null;

  function classify(target) {
    if (poisonReason !== null) {
      throw resultError(poisonReason);
    }

    let nativeResult;
    try {
      nativeResult = nativeClassify(target);
    } catch {
      poisonReason = 'RESULT_INSPECTION_FAILED';
      throw resultError(poisonReason);
    }

    const disposition = inspectResult(nativeResult);
    nativeResult = null;
    if (disposition.reason !== undefined) {
      poisonReason = disposition.reason;
      throw resultError(poisonReason);
    }
    return disposition.accepted;
  }

  return Object.freeze({ classify });
}

let loadDisposition = 'unattempted';
let cachedWrapper;
let cachedFailure;

function loadWindowsReparseClassifier() {
  if (loadDisposition === 'loaded') {
    return cachedWrapper;
  }
  if (loadDisposition === 'failed') {
    throw cachedFailure;
  }

  try {
    if (process.platform !== 'win32' || process.arch !== 'x64') {
      throw capabilityError('MOXLEY_NATIVE_PLATFORM_UNSUPPORTED');
    }
    const receipt = decodeReceipt(readReceiptBytes());
    authenticateArtifact(receipt);
    const nativeClassify = loadAddon();
    cachedWrapper = createWrapper(nativeClassify);
    loadDisposition = 'loaded';
    return cachedWrapper;
  } catch (error) {
    cachedFailure =
      error instanceof MoxleyNativeCapabilityError
        ? error
        : capabilityError('MOXLEY_NATIVE_LOAD_FAILED', error);
    loadDisposition = 'failed';
    throw cachedFailure;
  }
}

module.exports = Object.freeze({ loadWindowsReparseClassifier });
