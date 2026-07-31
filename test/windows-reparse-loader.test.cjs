'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const WORKER_ARGUMENT = '--moxley-native-loader-worker';
const IS_WORKER = process.argv[2] === WORKER_ARGUMENT;
const REPOSITORY_ROOT = path.resolve(__dirname, '..');
const LOADER = path.join(
  REPOSITORY_ROOT,
  'lib',
  'internal',
  'windows-reparse-classifier.cjs',
);
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
const REFERENCE_PREFIX = 'moxley-native-loader-test-';
const REFERENCE_ARTIFACT = 'qualified-moxley-windows-reparse.node';
const REFERENCE_RECEIPT = 'qualified-moxley-windows-reparse.receipt.json';
const REFERENCE_PROBE = 'ordinary-probe.txt';
const MAX_IO_BYTES = 1024 * 1024;
const PROCESS_TIMEOUT_MS = 120_000;

function canonicalJson(value) {
  return `${JSON.stringify(value)}\n`;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function exists(target) {
  try {
    await fsp.lstat(target);
    return true;
  } catch (error) {
    if (error !== null && error.code === 'ENOENT') return false;
    throw error;
  }
}

function ordinaryResult() {
  return {
    outcome: 'ordinary',
    fileAttributes: 0x20,
    reparseTag: 0,
    win32Error: 0,
    closeWin32Error: 0,
  };
}

function resultForVariant(variant, state) {
  if (variant === 'null') return null;
  if (variant === 'array') return [];
  if (variant === 'proxy') return new Proxy(ordinaryResult(), {});
  if (variant === 'null-prototype') {
    return Object.assign(Object.create(null), ordinaryResult());
  }
  if (variant === 'missing-key') {
    const result = ordinaryResult();
    delete result.closeWin32Error;
    return result;
  }
  if (variant === 'extra-key') {
    return { ...ordinaryResult(), extra: 0 };
  }
  if (variant === 'reordered-keys') {
    const result = {};
    result.fileAttributes = 0x20;
    result.outcome = 'ordinary';
    result.reparseTag = 0;
    result.win32Error = 0;
    result.closeWin32Error = 0;
    return result;
  }
  if (variant === 'symbol-key') {
    const result = ordinaryResult();
    result[Symbol('unexpected')] = 0;
    return result;
  }
  if (variant === 'accessor') {
    const result = {};
    Object.defineProperty(result, 'outcome', {
      enumerable: true,
      get() {
        throw new Error('ACCESSOR_MUST_NOT_RUN');
      },
    });
    Object.assign(result, {
      fileAttributes: 0x20,
      reparseTag: 0,
      win32Error: 0,
      closeWin32Error: 0,
    });
    return result;
  }
  if (variant === 'non-enumerable') {
    const result = {};
    Object.defineProperty(result, 'outcome', {
      value: 'ordinary',
      enumerable: false,
    });
    Object.assign(result, {
      fileAttributes: 0x20,
      reparseTag: 0,
      win32Error: 0,
      closeWin32Error: 0,
    });
    return result;
  }
  if (variant === 'bad-outcome') {
    return { ...ordinaryResult(), outcome: 'accepted' };
  }
  if (variant === 'numeric-string') {
    return { ...ordinaryResult(), fileAttributes: '32' };
  }
  if (variant === 'nan') {
    return { ...ordinaryResult(), reparseTag: Number.NaN };
  }
  if (variant === 'fraction') {
    return { ...ordinaryResult(), win32Error: 0.5 };
  }
  if (variant === 'negative') {
    return { ...ordinaryResult(), closeWin32Error: -1 };
  }
  if (variant === 'too-large') {
    return { ...ordinaryResult(), fileAttributes: 0x1_0000_0000 };
  }
  if (variant === 'ordinary-reparse-attribute') {
    return { ...ordinaryResult(), fileAttributes: 0x400 };
  }
  if (variant === 'ordinary-tag') {
    return { ...ordinaryResult(), reparseTag: 1 };
  }
  if (variant === 'ordinary-error') {
    return { ...ordinaryResult(), win32Error: 5 };
  }
  if (variant === 'reparse-no-attribute') {
    return { ...ordinaryResult(), outcome: 'reparse' };
  }
  if (variant === 'reparse-error') {
    return {
      ...ordinaryResult(),
      outcome: 'reparse',
      fileAttributes: 0x400,
      closeWin32Error: 6,
    };
  }
  if (variant === 'capability-without-error') {
    return { ...ordinaryResult(), outcome: 'capability-gap' };
  }
  if (variant === 'poison') {
    return state.calls === 1 ? null : ordinaryResult();
  }
  return ordinaryResult();
}

function addonForVariant(variant, state) {
  if (variant === 'export-empty') return {};
  if (variant === 'export-extra') {
    return { classify() {}, extra() {} };
  }
  if (variant === 'export-nonfunction') return { classify: 1 };
  if (variant === 'export-array') {
    const addon = [];
    addon.classify = () => ordinaryResult();
    return addon;
  }
  if (variant === 'export-accessor') {
    const addon = {};
    Object.defineProperty(addon, 'classify', {
      enumerable: true,
      get() {
        throw new Error('EXPORT_ACCESSOR_MUST_NOT_RUN');
      },
    });
    return addon;
  }

  return {
    classify(target) {
      state.calls += 1;
      if (variant === 'native-throws') {
        throw new RangeError('UNBOUNDED_NATIVE_THROW');
      }
      if (variant === 'copy-results') {
        const nativeResult =
          target === 'ordinary'
            ? ordinaryResult()
            : target === 'reparse'
              ? {
                  outcome: 'reparse',
                  fileAttributes: 0x420,
                  reparseTag: 0,
                  win32Error: 0,
                  closeWin32Error: 0,
                }
              : {
                  outcome: 'capability-gap',
                  fileAttributes: 0,
                  reparseTag: 0x1234,
                  win32Error: 13,
                  closeWin32Error: 0,
                };
        state.nativeResults.push(nativeResult);
        return nativeResult;
      }
      const result = resultForVariant(variant, state);
      state.lastResult = result;
      return result;
    },
  };
}

function summarizeError(error) {
  return {
    name: error.name,
    code: error.code,
    message: error.message,
    causePresent: error.cause !== undefined,
    causeName: error.cause === undefined ? null : error.cause.name,
    causeCode:
      error.cause === undefined || typeof error.cause.code !== 'string'
        ? null
        : error.cause.code,
    causeMessage:
      error.cause === undefined ||
      !/^(?:RESULT_[A-Z_]+|SYNTHETIC_NATIVE_LOAD_FAILURE)$/.test(
        error.cause.message,
      )
        ? null
        : error.cause.message,
  };
}

function captureFailure(operation) {
  try {
    operation();
  } catch (error) {
    assert.equal(error.name, 'MoxleyNativeCapabilityError');
    assert.doesNotMatch(error.message, /[A-Za-z]:\\/);
    assert.doesNotMatch(error.message, /[\r\n]/);
    return error;
  }
  assert.fail('operation unexpectedly succeeded');
}

async function replaceWithReference(referenceRoot, sourceName, target) {
  await fsp.rm(target, { force: true });
  await fsp.copyFile(
    path.join(referenceRoot, sourceName),
    target,
    fs.constants.COPYFILE_EXCL,
  );
}

async function restoreGeneratedPair(referenceRoot) {
  await fsp.mkdir(RELEASE, { recursive: true });
  await replaceWithReference(referenceRoot, REFERENCE_ARTIFACT, ARTIFACT);
  await replaceWithReference(referenceRoot, REFERENCE_RECEIPT, RECEIPT);
}

function installInstrumentation(request, state) {
  const counters = {
    receiptReads: 0,
    artifactReads: 0,
    hashes: 0,
    requireCalls: 0,
  };
  const originalReadFileSync = fs.readFileSync;
  fs.readFileSync = function instrumentedReadFileSync(target, ...arguments_) {
    const resolved = typeof target === 'string' ? path.resolve(target) : '';
    if (resolved === RECEIPT) counters.receiptReads += 1;
    if (resolved === ARTIFACT) counters.artifactReads += 1;
    return originalReadFileSync.call(this, target, ...arguments_);
  };

  const crypto = require('node:crypto');
  const originalCreateHash = crypto.createHash;
  crypto.createHash = function instrumentedCreateHash(algorithm, ...arguments_) {
    if (algorithm === 'sha256') counters.hashes += 1;
    return originalCreateHash.call(this, algorithm, ...arguments_);
  };

  const originalLoad = Module._load;
  Module._load = function instrumentedLoad(moduleRequest, parent, isMain) {
    if (
      typeof moduleRequest === 'string' &&
      path.resolve(moduleRequest) === ARTIFACT
    ) {
      counters.requireCalls += 1;
      if (request.scenario === 'load-failure') {
        const error = new Error('SYNTHETIC_NATIVE_LOAD_FAILURE');
        error.code = 'SYNTHETIC_LOAD_CODE';
        throw error;
      }
    }
    return originalLoad.call(this, moduleRequest, parent, isMain);
  };

  if (
    request.scenario !== 'real-valid' &&
    request.scenario !== 'unsupported' &&
    request.scenario !== 'terminal-load' &&
    request.scenario !== 'load-failure'
  ) {
    require.cache[ARTIFACT] = {
      id: ARTIFACT,
      filename: ARTIFACT,
      loaded: true,
      exports: addonForVariant(request.variant, state),
    };
  }
  return counters;
}

function assertOuter(error, code, message) {
  assert.equal(error.code, code);
  assert.equal(error.message, message);
}

async function runWorkerScenario(request) {
  if (request.scenario === 'unsupported') {
    Object.defineProperty(process, request.variant, {
      configurable: true,
      value: request.variant === 'platform' ? 'linux' : 'arm64',
    });
  }

  const state = { calls: 0, lastResult: null, nativeResults: [] };
  const counters = installInstrumentation(request, state);
  const { loadWindowsReparseClassifier } = require(LOADER);

  if (request.scenario === 'real-valid') {
    const wrapper = loadWindowsReparseClassifier();
    const result = wrapper.classify(
      path.join(request.referenceRoot, REFERENCE_PROBE),
    );
    assert.deepEqual(Object.keys(wrapper), ['classify']);
    assert.equal(Object.isFrozen(wrapper), true);
    assert.equal(Object.isFrozen(result), true);
    assert.deepEqual(result, ordinaryResult());
    return { counters, result };
  }

  if (request.scenario === 'successful-cache') {
    const first = loadWindowsReparseClassifier();
    const second = loadWindowsReparseClassifier();
    assert.equal(first, second);
    assert.equal(Object.isFrozen(first), true);
    assert.deepEqual(first.classify('ignored'), ordinaryResult());
    return { counters, calls: state.calls, sameWrapper: first === second };
  }

  if (request.scenario === 'copy-results') {
    const wrapper = loadWindowsReparseClassifier();
    const accepted = ['ordinary', 'reparse', 'capability-gap'].map((value) =>
      wrapper.classify(value),
    );
    assert.equal(state.calls, 3);
    for (let index = 0; index < accepted.length; index += 1) {
      assert.notEqual(accepted[index], state.nativeResults[index]);
      assert.equal(Object.isFrozen(accepted[index]), true);
      assert.equal(Object.isFrozen(state.nativeResults[index]), false);
      assert.deepEqual(Object.keys(accepted[index]), [
        'outcome',
        'fileAttributes',
        'reparseTag',
        'win32Error',
        'closeWin32Error',
      ]);
    }
    return {
      counters,
      calls: state.calls,
      outcomes: accepted.map((value) => value.outcome),
    };
  }

  if (request.scenario === 'unsupported') {
    const first = captureFailure(loadWindowsReparseClassifier);
    const afterFirst = { ...counters };
    const second = captureFailure(loadWindowsReparseClassifier);
    assertOuter(
      first,
      'MOXLEY_NATIVE_PLATFORM_UNSUPPORTED',
      'Native classifier is unsupported on this platform.',
    );
    assert.equal(first, second);
    assert.deepEqual(counters, afterFirst);
    return {
      counters,
      error: summarizeError(first),
      sameError: first === second,
    };
  }

  if (request.scenario === 'terminal-load') {
    const first = captureFailure(loadWindowsReparseClassifier);
    const afterFirst = { ...counters };
    await restoreGeneratedPair(request.referenceRoot);
    const second = captureFailure(loadWindowsReparseClassifier);
    assert.equal(first, second);
    assert.deepEqual(counters, afterFirst);
    return {
      counters,
      error: summarizeError(first),
      sameError: first === second,
    };
  }

  if (request.scenario === 'load-failure') {
    const first = captureFailure(loadWindowsReparseClassifier);
    const afterFirst = { ...counters };
    const second = captureFailure(loadWindowsReparseClassifier);
    assertOuter(
      first,
      'MOXLEY_NATIVE_LOAD_FAILED',
      'Native classifier failed to load.',
    );
    assert.equal(first, second);
    assert.deepEqual(counters, afterFirst);
    return {
      counters,
      error: summarizeError(first),
      sameError: first === second,
    };
  }

  if (request.scenario === 'export-invalid') {
    const first = captureFailure(loadWindowsReparseClassifier);
    const afterFirst = { ...counters };
    require.cache[ARTIFACT].exports = addonForVariant('valid', state);
    const second = captureFailure(loadWindowsReparseClassifier);
    assertOuter(
      first,
      'MOXLEY_NATIVE_EXPORT_INVALID',
      'Native classifier export is invalid.',
    );
    assert.equal(first, second);
    assert.deepEqual(counters, afterFirst);
    return {
      counters,
      error: summarizeError(first),
      sameError: first === second,
    };
  }

  const wrapper = loadWindowsReparseClassifier();
  if (request.scenario === 'reflect-failure') {
    const original =
      request.variant === 'own-keys'
        ? Reflect.ownKeys
        : request.variant === 'descriptor'
          ? Reflect.getOwnPropertyDescriptor
          : Object.getPrototypeOf;
    const replacement = function throwingInspection(target, ...arguments_) {
      if (target === state.lastResult) {
        throw new Error('UNBOUNDED_REFLECTION_THROW');
      }
      return original.call(this, target, ...arguments_);
    };
    if (request.variant === 'own-keys') Reflect.ownKeys = replacement;
    else if (request.variant === 'descriptor') {
      Reflect.getOwnPropertyDescriptor = replacement;
    } else Object.getPrototypeOf = replacement;
  }

  if (request.scenario === 'poison') {
    const first = captureFailure(() => wrapper.classify('first'));
    const second = captureFailure(() => wrapper.classify('second'));
    const third = captureFailure(() => wrapper.classify('third'));
    assert.equal(state.calls, 1);
    assert.notEqual(first.cause, second.cause);
    assert.notEqual(second.cause, third.cause);
    for (const error of [first, second, third]) {
      assertOuter(
        error,
        'MOXLEY_NATIVE_RESULT_INVALID',
        'Native classifier returned invalid result evidence.',
      );
      assert.equal(error.cause.name, 'TypeError');
      assert.equal(error.cause.message, 'RESULT_NOT_OBJECT');
    }
    return {
      counters,
      calls: state.calls,
      errors: [first, second, third].map(summarizeError),
    };
  }

  const error = captureFailure(() => wrapper.classify('case'));
  assertOuter(
    error,
    'MOXLEY_NATIVE_RESULT_INVALID',
    'Native classifier returned invalid result evidence.',
  );
  assert.equal(error.cause.name, 'TypeError');
  return {
    counters,
    calls: state.calls,
    error: summarizeError(error),
  };
}

function readBoundedRequest() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    process.stdin.on('data', (chunk) => {
      length += chunk.length;
      if (length > MAX_IO_BYTES) {
        reject(new Error('request too large'));
        process.stdin.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    process.stdin.once('error', reject);
    process.stdin.once('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        if (!text.endsWith('\n') || text.indexOf('\n') !== text.length - 1) {
          throw new Error('request framing invalid');
        }
        const request = JSON.parse(text.slice(0, -1));
        if (
          canonicalJson(request) !== text ||
          JSON.stringify(Object.keys(request)) !==
            JSON.stringify([
              'requestFormat',
              'requestVersion',
              'scenario',
              'variant',
              'referenceRoot',
            ]) ||
          request.requestFormat !== 'moxley-native-loader-test' ||
          request.requestVersion !== 1 ||
          typeof request.scenario !== 'string' ||
          typeof request.variant !== 'string' ||
          !(
            request.referenceRoot === null ||
            typeof request.referenceRoot === 'string'
          )
        ) {
          throw new Error('request invalid');
        }
        resolve(request);
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function workerMain() {
  if (process.argv.length !== 3) throw new Error('worker arguments invalid');
  const request = await readBoundedRequest();
  const evidence = await runWorkerScenario(request);
  process.stdout.write(canonicalJson({ status: 'ok', evidence }));
}

if (IS_WORKER) {
  workerMain().catch(() => {
    process.stderr.write('Native loader test worker failed.\n');
    process.exitCode = 1;
  });
} else {
  const { after, before, test } = require('node:test');
  let referenceRoot = null;
  let referenceEvidence = null;
  let repositoryOutputMayExist = false;

  function runProcess(file, arguments_, options = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(file, arguments_, {
        cwd: options.cwd,
        env: process.env,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      const stdout = [];
      const stderr = [];
      let stdoutLength = 0;
      let stderrLength = 0;
      const timeout = setTimeout(() => child.kill(), PROCESS_TIMEOUT_MS);
      child.once('error', reject);
      child.stdout.on('data', (chunk) => {
        stdoutLength += chunk.length;
        if (stdoutLength > MAX_IO_BYTES) child.kill();
        else stdout.push(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderrLength += chunk.length;
        if (stderrLength > MAX_IO_BYTES) child.kill();
        else stderr.push(chunk);
      });
      child.once('close', (code, signal) => {
        clearTimeout(timeout);
        if (stdoutLength > MAX_IO_BYTES || stderrLength > MAX_IO_BYTES) {
          reject(new Error('bounded test subprocess output exceeded'));
          return;
        }
        resolve({
          code,
          signal,
          stdout: Buffer.concat(stdout),
          stderr: Buffer.concat(stderr),
        });
      });
      if (options.input === undefined) child.stdin.end();
      else child.stdin.end(options.input);
    });
  }

  function parseCanonicalOutput(bytes) {
    const text = bytes.toString('utf8');
    assert.equal(text.endsWith('\n'), true);
    assert.equal(text.indexOf('\n'), text.length - 1);
    assert.equal(text.includes('\r'), false);
    const value = JSON.parse(text.slice(0, -1));
    assert.equal(canonicalJson(value), text);
    return value;
  }

  async function runNodeScript(script) {
    return runProcess(process.execPath, [script], { cwd: os.tmpdir() });
  }

  async function runLoaderWorker(scenario, variant = '', root = referenceRoot) {
    const request = {
      requestFormat: 'moxley-native-loader-test',
      requestVersion: 1,
      scenario,
      variant,
      referenceRoot: root,
    };
    const result = await runProcess(
      process.execPath,
      [__filename, WORKER_ARGUMENT],
      { cwd: root === null ? os.tmpdir() : root, input: canonicalJson(request) },
    );
    assert.equal(result.code, 0, result.stderr.toString('utf8'));
    assert.equal(result.signal, null);
    assert.equal(result.stderr.length, 0);
    const response = parseCanonicalOutput(result.stdout);
    assert.equal(response.status, 'ok');
    return response.evidence;
  }

  async function releaseEntries() {
    if (!(await exists(RELEASE))) return [];
    return (await fsp.readdir(RELEASE)).sort();
  }

  async function assertGeneratedStateAbsent() {
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

  async function authenticateReferenceRoot() {
    assert.notEqual(referenceRoot, null);
    const tempRoot = await fsp.realpath(os.tmpdir());
    const canonicalRoot = await fsp.realpath(referenceRoot);
    const metadata = await fsp.lstat(referenceRoot);
    assert.equal(metadata.isDirectory(), true);
    assert.equal(metadata.isSymbolicLink(), false);
    assert.equal(path.dirname(canonicalRoot).toLowerCase(), tempRoot.toLowerCase());
    assert.equal(path.basename(canonicalRoot).startsWith(REFERENCE_PREFIX), true);
    const entries = (await fsp.readdir(canonicalRoot)).sort();
    assert.deepEqual(entries, [
      REFERENCE_PROBE,
      REFERENCE_ARTIFACT,
      REFERENCE_RECEIPT,
    ].sort());
    return canonicalRoot;
  }

  async function explicitClean() {
    const result = await runNodeScript(CLEAN_SCRIPT);
    assert.equal(result.code, 0, result.stderr.toString('utf8'));
    assert.equal(result.signal, null);
    assert.equal(result.stderr.length, 0);
    const output = parseCanonicalOutput(result.stdout);
    assert.equal(output.status, 'clean');
    repositoryOutputMayExist = false;
    await assertGeneratedStateAbsent();
    return output;
  }

  async function installReferenceOutputs(options = {}) {
    await assertGeneratedStateAbsent();
    await fsp.mkdir(RELEASE, { recursive: true });
    if (options.artifact !== false) {
      if (options.artifactBytes === undefined) {
        await fsp.copyFile(
          path.join(referenceRoot, REFERENCE_ARTIFACT),
          ARTIFACT,
          fs.constants.COPYFILE_EXCL,
        );
      } else {
        await fsp.writeFile(ARTIFACT, options.artifactBytes, { flag: 'wx' });
      }
    }
    if (options.receipt !== false) {
      if (options.receiptBytes === undefined) {
        await fsp.copyFile(
          path.join(referenceRoot, REFERENCE_RECEIPT),
          RECEIPT,
          fs.constants.COPYFILE_EXCL,
        );
      } else {
        await fsp.writeFile(RECEIPT, options.receiptBytes, { flag: 'wx' });
      }
    }
    repositoryOutputMayExist = true;
  }

  async function withReferenceOutputs(operation, options = {}) {
    await installReferenceOutputs(options);
    try {
      return await operation();
    } finally {
      await explicitClean();
    }
  }

  function assertTerminalEvidence(
    evidence,
    code,
    message,
    expectedCounters,
  ) {
    assert.equal(evidence.sameError, true);
    assert.equal(evidence.error.name, 'MoxleyNativeCapabilityError');
    assert.equal(evidence.error.code, code);
    assert.equal(evidence.error.message, message);
    assert.deepEqual(evidence.counters, expectedCounters);
  }

  before(async () => {
    await assertGeneratedStateAbsent();
    const build = await runNodeScript(BUILD_SCRIPT);
    assert.equal(build.code, 0, build.stderr.toString('utf8'));
    assert.equal(build.signal, null);
    assert.equal(build.stderr.length, 0);
    const buildOutput = parseCanonicalOutput(build.stdout);
    assert.equal(buildOutput.status, 'built');
    repositoryOutputMayExist = true;

    referenceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), REFERENCE_PREFIX));
    await fsp.copyFile(
      ARTIFACT,
      path.join(referenceRoot, REFERENCE_ARTIFACT),
      fs.constants.COPYFILE_EXCL,
    );
    await fsp.copyFile(
      RECEIPT,
      path.join(referenceRoot, REFERENCE_RECEIPT),
      fs.constants.COPYFILE_EXCL,
    );
    await fsp.writeFile(
      path.join(referenceRoot, REFERENCE_PROBE),
      'ordinary\n',
      { encoding: 'utf8', flag: 'wx' },
    );
    await authenticateReferenceRoot();
    const artifactBytes = await fsp.readFile(
      path.join(referenceRoot, REFERENCE_ARTIFACT),
    );
    const receiptBytes = await fsp.readFile(
      path.join(referenceRoot, REFERENCE_RECEIPT),
    );
    const receipt = JSON.parse(receiptBytes.toString('utf8'));
    referenceEvidence = Object.freeze({
      artifactByteLength: artifactBytes.length,
      artifactSha256: sha256(artifactBytes),
      receiptArtifactByteLength: receipt.artifact.byteLength,
      receiptArtifactSha256: receipt.artifact.sha256,
    });
    assert.equal(
      referenceEvidence.artifactByteLength,
      referenceEvidence.receiptArtifactByteLength,
    );
    assert.equal(
      referenceEvidence.artifactSha256,
      referenceEvidence.receiptArtifactSha256,
    );
  });

  after(async () => {
    if (
      repositoryOutputMayExist ||
      (await exists(ARTIFACT)) ||
      (await exists(RECEIPT)) ||
      (await exists(LOCK))
    ) {
      await explicitClean();
    }
    await assertGeneratedStateAbsent();
    if (referenceRoot !== null && (await exists(referenceRoot))) {
      const canonicalRoot = await authenticateReferenceRoot();
      await fsp.rm(canonicalRoot, { recursive: true, force: false });
      assert.equal(await exists(canonicalRoot), false);
    }
  });

  test('private loader exports only the synchronous one-shot loader', () => {
    const surface = require(LOADER);
    assert.deepEqual(Reflect.ownKeys(surface), [
      'loadWindowsReparseClassifier',
    ]);
    assert.equal(Object.isFrozen(surface), true);
    assert.equal(typeof surface.loadWindowsReparseClassifier, 'function');
    assert.equal(surface.loadWindowsReparseClassifier.length, 0);
    assert.notEqual(
      surface.loadWindowsReparseClassifier.constructor.name,
      'AsyncFunction',
    );
  });

  test(
    'valid load authenticates the canonical receipt and package-relative artifact',
    async () => {
      const evidence = await runLoaderWorker('real-valid');
      assert.deepEqual(evidence.result, ordinaryResult());
      assert.deepEqual(evidence.counters, {
        receiptReads: 1,
        artifactReads: 1,
        hashes: 1,
        requireCalls: 1,
      });
      assert.equal(
        referenceEvidence.artifactSha256,
        referenceEvidence.receiptArtifactSha256,
      );
      await explicitClean();
    },
  );

  test(
    'successful loading returns and reuses one frozen wrapper without reloading',
    async () => {
      await withReferenceOutputs(async () => {
        const evidence = await runLoaderWorker('successful-cache', 'valid');
        assert.equal(evidence.sameWrapper, true);
        assert.equal(evidence.calls, 1);
        assert.deepEqual(evidence.counters, {
          receiptReads: 1,
          artifactReads: 1,
          hashes: 1,
          requireCalls: 1,
        });
      });
    },
  );

  test(
    'ordinary reparse and capability-gap evidence is copied frozen and invoked once',
    async () => {
      await withReferenceOutputs(async () => {
        const evidence = await runLoaderWorker('copy-results', 'copy-results');
        assert.equal(evidence.calls, 3);
        assert.deepEqual(evidence.outcomes, [
          'ordinary',
          'reparse',
          'capability-gap',
        ]);
      });
    },
  );

  test('unsupported platform or architecture fails terminally', async () => {
    await assertGeneratedStateAbsent();
    for (const variant of ['platform', 'arch']) {
      const evidence = await runLoaderWorker('unsupported', variant, null);
      assertTerminalEvidence(
        evidence,
        'MOXLEY_NATIVE_PLATFORM_UNSUPPORTED',
        'Native classifier is unsupported on this platform.',
        {
          receiptReads: 0,
          artifactReads: 0,
          hashes: 0,
          requireCalls: 0,
        },
      );
    }
  });

  test('missing or incomplete generated output fails terminally', async () => {
    const cases = [
      { artifact: false, receipt: false, reads: 0 },
      { artifact: true, receipt: false, reads: 0 },
      { artifact: false, receipt: true, reads: 1 },
    ];
    for (const item of cases) {
      await installReferenceOutputs(item);
      try {
        const evidence = await runLoaderWorker('terminal-load', 'missing');
        assertTerminalEvidence(
          evidence,
          'MOXLEY_NATIVE_ARTIFACT_MISSING',
          'Native classifier artifact is missing.',
          {
            receiptReads: item.reads,
            artifactReads: 0,
            hashes: 0,
            requireCalls: 0,
          },
        );
        assert.equal(evidence.error.causePresent, true);
        assert.equal(evidence.error.causeCode, 'ENOENT');
      } finally {
        await explicitClean();
      }
    }
  });

  test(
    'malformed noncanonical or incompatible receipts fail terminally',
    async () => {
      const referenceBytes = await fsp.readFile(
        path.join(referenceRoot, REFERENCE_RECEIPT),
      );
      const reference = JSON.parse(referenceBytes.toString('utf8'));
      const incompatibleNode = structuredClone(reference);
      incompatibleNode.target.nodeVersion = 'v24.13.1';
      const incompatibleApi = structuredClone(reference);
      incompatibleApi.target.nodeApiVersion = 7;
      const wrongSource = structuredClone(reference);
      wrongSource.source.path = 'test/native/windows-reparse-classifier.c';
      const wrongArtifact = structuredClone(reference);
      wrongArtifact.artifact.path = 'build/Debug/other.node';
      const extraKey = structuredClone(reference);
      extraKey.extra = true;
      const reordered = {
        receiptVersion: reference.receiptVersion,
        receiptFormat: reference.receiptFormat,
        nativeContractVersion: reference.nativeContractVersion,
        target: reference.target,
        source: reference.source,
        toolchain: reference.toolchain,
        artifact: reference.artifact,
      };
      const text = referenceBytes.toString('utf8');
      const duplicate = text.replace(
        '{"receiptFormat":',
        '{"receiptFormat":"duplicate","receiptFormat":',
      );
      const cases = [
        Buffer.from([0xff, 0x0a]),
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), referenceBytes]),
        referenceBytes.subarray(0, referenceBytes.length - 1),
        Buffer.concat([referenceBytes, Buffer.from('\n')]),
        Buffer.from(`${JSON.stringify(reference, null, 2)}\n`),
        Buffer.from(duplicate),
        Buffer.from(canonicalJson(extraKey)),
        Buffer.from(canonicalJson(reordered)),
        Buffer.from(canonicalJson(incompatibleNode)),
        Buffer.from(canonicalJson(incompatibleApi)),
        Buffer.from(canonicalJson(wrongSource)),
        Buffer.from(canonicalJson(wrongArtifact)),
      ];
      for (const receiptBytes of cases) {
        await withReferenceOutputs(
          async () => {
            const evidence = await runLoaderWorker(
              'terminal-load',
              'receipt-invalid',
            );
            assertTerminalEvidence(
              evidence,
              'MOXLEY_NATIVE_RECEIPT_INVALID',
              'Native classifier receipt is invalid.',
              evidence.counters,
            );
            assert.equal(evidence.counters.hashes, 0);
            assert.equal(evidence.counters.requireCalls, 0);
          },
          { receiptBytes },
        );
      }
    },
  );

  test('artifact byte-length or digest mismatch fails terminally', async () => {
    const referenceBytes = await fsp.readFile(
      path.join(referenceRoot, REFERENCE_RECEIPT),
    );
    const reference = JSON.parse(referenceBytes.toString('utf8'));
    const cases = [];
    const badLength = structuredClone(reference);
    badLength.artifact.byteLength += 1;
    cases.push({
      receiptBytes: Buffer.from(canonicalJson(badLength)),
      counters: {
        receiptReads: 1,
        artifactReads: 0,
        hashes: 0,
        requireCalls: 0,
      },
    });
    const badDigest = structuredClone(reference);
    badDigest.artifact.sha256 = '0'.repeat(64);
    cases.push({
      receiptBytes: Buffer.from(canonicalJson(badDigest)),
      counters: {
        receiptReads: 1,
        artifactReads: 1,
        hashes: 1,
        requireCalls: 0,
      },
    });
    for (const item of cases) {
      await withReferenceOutputs(
        async () => {
          const evidence = await runLoaderWorker(
            'terminal-load',
            'integrity-invalid',
          );
          assertTerminalEvidence(
            evidence,
            'MOXLEY_NATIVE_INTEGRITY_MISMATCH',
            'Native classifier artifact integrity check failed.',
            item.counters,
          );
        },
        { receiptBytes: item.receiptBytes },
      );
    }
  });

  test(
    'native addon load failure retains bounded causal evidence without retry',
    async () => {
      await withReferenceOutputs(async () => {
        const evidence = await runLoaderWorker('load-failure');
        assertTerminalEvidence(
          evidence,
          'MOXLEY_NATIVE_LOAD_FAILED',
          'Native classifier failed to load.',
          {
            receiptReads: 1,
            artifactReads: 1,
            hashes: 1,
            requireCalls: 1,
          },
        );
        assert.equal(evidence.error.causePresent, true);
        assert.equal(evidence.error.causeName, 'Error');
        assert.equal(evidence.error.causeCode, 'SYNTHETIC_LOAD_CODE');
        assert.equal(
          evidence.error.causeMessage,
          'SYNTHETIC_NATIVE_LOAD_FAILURE',
        );
      });
    },
  );

  test('invalid native export shape fails terminally', async () => {
    await withReferenceOutputs(async () => {
      for (const variant of [
        'export-empty',
        'export-extra',
        'export-nonfunction',
        'export-array',
        'export-accessor',
      ]) {
        const evidence = await runLoaderWorker('export-invalid', variant);
        assertTerminalEvidence(
          evidence,
          'MOXLEY_NATIVE_EXPORT_INVALID',
          'Native classifier export is invalid.',
          {
            receiptReads: 1,
            artifactReads: 1,
            hashes: 1,
            requireCalls: 1,
          },
        );
      }
    });
  });

  test(
    'invalid result objects keys prototypes proxies and symbols use the closed reasons',
    async () => {
      await withReferenceOutputs(async () => {
        const cases = new Map([
          ['null', 'RESULT_NOT_OBJECT'],
          ['array', 'RESULT_NOT_OBJECT'],
          ['proxy', 'RESULT_NOT_OBJECT'],
          ['null-prototype', 'RESULT_NOT_OBJECT'],
          ['missing-key', 'RESULT_KEY_SET_INVALID'],
          ['extra-key', 'RESULT_KEY_SET_INVALID'],
          ['reordered-keys', 'RESULT_KEY_SET_INVALID'],
          ['symbol-key', 'RESULT_KEY_SET_INVALID'],
        ]);
        for (const [variant, reason] of cases) {
          const evidence = await runLoaderWorker('invalid-result', variant);
          assert.equal(evidence.calls, 1);
          assert.equal(evidence.error.code, 'MOXLEY_NATIVE_RESULT_INVALID');
          assert.equal(evidence.error.causeName, 'TypeError');
          assert.equal(evidence.error.causeMessage, reason);
        }
      });
    },
  );

  test(
    'invalid descriptors fields and outcome combinations use the closed reasons',
    async () => {
      await withReferenceOutputs(async () => {
        const cases = new Map([
          ['accessor', 'RESULT_DESCRIPTOR_INVALID'],
          ['non-enumerable', 'RESULT_DESCRIPTOR_INVALID'],
          ['bad-outcome', 'RESULT_FIELD_INVALID'],
          ['numeric-string', 'RESULT_FIELD_INVALID'],
          ['nan', 'RESULT_FIELD_INVALID'],
          ['fraction', 'RESULT_FIELD_INVALID'],
          ['negative', 'RESULT_FIELD_INVALID'],
          ['too-large', 'RESULT_FIELD_INVALID'],
          ['ordinary-reparse-attribute', 'RESULT_OUTCOME_INCONSISTENT'],
          ['ordinary-tag', 'RESULT_OUTCOME_INCONSISTENT'],
          ['ordinary-error', 'RESULT_OUTCOME_INCONSISTENT'],
          ['reparse-no-attribute', 'RESULT_OUTCOME_INCONSISTENT'],
          ['reparse-error', 'RESULT_OUTCOME_INCONSISTENT'],
          ['capability-without-error', 'RESULT_OUTCOME_INCONSISTENT'],
        ]);
        for (const [variant, reason] of cases) {
          const evidence = await runLoaderWorker('invalid-result', variant);
          assert.equal(evidence.calls, 1);
          assert.equal(evidence.error.causeName, 'TypeError');
          assert.equal(evidence.error.causeMessage, reason);
        }
      });
    },
  );

  test(
    'native or reflective inspection failures become bounded result-invalid evidence',
    async () => {
      await withReferenceOutputs(async () => {
        const native = await runLoaderWorker('invalid-result', 'native-throws');
        assert.equal(native.calls, 1);
        assert.equal(native.error.causeName, 'TypeError');
        assert.equal(native.error.causeMessage, 'RESULT_INSPECTION_FAILED');
        for (const variant of ['prototype', 'own-keys', 'descriptor']) {
          const reflected = await runLoaderWorker('reflect-failure', variant);
          assert.equal(reflected.calls, 1);
          assert.equal(reflected.error.causeName, 'TypeError');
          assert.equal(
            reflected.error.causeMessage,
            'RESULT_INSPECTION_FAILED',
          );
        }
      });
    },
  );

  test(
    'the first invalid result poisons the wrapper and prevents every later native call',
    async () => {
      await withReferenceOutputs(async () => {
        const evidence = await runLoaderWorker('poison', 'poison');
        assert.equal(evidence.calls, 1);
        assert.equal(evidence.errors.length, 3);
        for (const error of evidence.errors) {
          assert.equal(error.code, 'MOXLEY_NATIVE_RESULT_INVALID');
          assert.equal(
            error.message,
            'Native classifier returned invalid result evidence.',
          );
          assert.equal(error.causeName, 'TypeError');
          assert.equal(error.causeMessage, 'RESULT_NOT_OBJECT');
        }
      });
    },
  );
}
