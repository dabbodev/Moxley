'use strict';

const assert = require('node:assert/strict');
const { execFile, spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const TASK_PREFIX = 'moxley-native-reparse-';
const PROCESS_TIMEOUT_MS = 30_000;
const WORKER_TIMEOUT_MS = 10_000;
const MAX_PROCESS_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_WORKER_REQUEST_BYTES = 128 * 1024;
const MAX_WORKER_ERROR_FIELD_LENGTH = 64;
const WORKER_ARGUMENT = '--moxley-native-worker';
const IS_WORKER_MODE = process.argv[2] === WORKER_ARGUMENT;
const REPARSE_ATTRIBUTE = 0x00000400;
const EXPECTED_RESULT_KEYS = Object.freeze([
  'outcome',
  'fileAttributes',
  'reparseTag',
  'win32Error',
  'closeWin32Error',
]);
const OPTIONAL_SYMLINK_GAP_CODES = new Set([
  'EACCES',
  'ENOSYS',
  'ENOTSUP',
  'EOPNOTSUPP',
  'EPERM',
]);
const WORKER_OPERATIONS = new Set([
  'classify',
  'expect-load-error',
  'input-contract',
  'load',
]);

let after;
let before;
let describe;
let it;
if (!IS_WORKER_MODE) {
  ({
    after,
    before,
    describe,
    it,
  } = require('node:test'));
}

const REPOSITORY_ROOT = path.resolve(__dirname, '..');
const NATIVE_SOURCE = path.join(
  __dirname,
  'native',
  'windows-reparse-classifier.c',
);
const VS_ROOT =
  'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools';
const VS_DEV_CMD = path.join(
  VS_ROOT,
  'Common7',
  'Tools',
  'VsDevCmd.bat',
);
const MSVC_VERSION = '14.44.35207';
const MSVC_BIN = path.join(
  VS_ROOT,
  'VC',
  'Tools',
  'MSVC',
  MSVC_VERSION,
  'bin',
  'Hostx64',
  'x64',
);
const CL_EXE = path.join(MSVC_BIN, 'cl.exe');
const LINK_EXE = path.join(MSVC_BIN, 'link.exe');
const MSVC_INCLUDE = path.join(
  VS_ROOT,
  'VC',
  'Tools',
  'MSVC',
  MSVC_VERSION,
  'include',
);
const MSVC_LIB = path.join(
  VS_ROOT,
  'VC',
  'Tools',
  'MSVC',
  MSVC_VERSION,
  'lib',
  'x64',
);
const WINDOWS_SDK_VERSION = '10.0.26100.0';
const WINDOWS_SDK_ROOT =
  'C:\\Program Files (x86)\\Windows Kits\\10';
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
  WINDOWS_SDK_ROOT,
  'Lib',
  WINDOWS_SDK_VERSION,
  'um',
  'x64',
  'Kernel32.Lib',
);
const NODE_CACHE_ROOT = process.env.LOCALAPPDATA === undefined
  ? ''
  : path.join(
      process.env.LOCALAPPDATA,
      'node-gyp',
      'Cache',
      '24.13.0',
    );
const NODE_INCLUDE = path.join(NODE_CACHE_ROOT, 'include', 'node');
const NODE_LIB = path.join(NODE_CACHE_ROOT, 'x64', 'node.lib');
const EXPECTED_KERNEL32 = Object.freeze({
  byteLength: 311_908,
  sha256:
    '341c7d56125a03b458e4d5093e4c79b33123ccfdfd610fe236937b8e6f3134bb',
});
const EXPECTED_NODE_LIB = Object.freeze({
  byteLength: 2_869_366,
  sha256:
    'be205f2934c17fbd56ce6cdfcfbeb2f6a85061d5141e7a58eba240a8477a12fd',
});
const REQUIRED_NODE_HEADERS = Object.freeze([
  'node_api.h',
  'node_api_types.h',
  'js_native_api.h',
  'js_native_api_types.h',
  'node_version.h',
]);
const REQUIRED_SDK_TOKENS = Object.freeze([
  'CreateFileW',
  'GetFileInformationByHandleEx',
  'FILE_ATTRIBUTE_TAG_INFO',
  'FILE_ATTRIBUTE_REPARSE_POINT',
  'FILE_FLAG_OPEN_REPARSE_POINT',
  'FILE_FLAG_BACKUP_SEMANTICS',
]);

// Characterization only. This suite compiles and invokes a disposable native
// test harness in task-owned OS-temporary storage. It does not import Moxley,
// implement traversal, qualify a persisted format, or establish TOCTOU,
// containment, locking, recovery, durability, or production-runtime safety.
const receipt = {
  platform: process.platform,
  architecture: process.arch,
  nodeVersion: process.version,
  modulesAbi: process.versions.modules,
  nodeApi: process.versions.napi,
  compiler: 'unconfirmed',
  linker: 'unconfirmed',
  windowsSdk: 'unconfirmed',
  nodeInputs: 'unconfirmed',
  build: {
    normal: 'unconfirmed',
    queryFailure: 'unconfirmed',
  },
  load: 'unconfirmed',
  ordinary: 'unconfirmed',
  junction: 'unconfirmed',
  hardLink: 'unconfirmed',
  symbolicLinks: [],
  absentObject: 'unconfirmed',
  injectedQueryFailure: 'unconfirmed',
  loadErrors: {
    missing: {
      name: 'unconfirmed',
      code: 'unconfirmed',
    },
    malformed: {
      name: 'unconfirmed',
      code: 'unconfirmed',
    },
  },
  cleanup: 'unconfirmed',
  overallQualification: 'no-go',
};

let normalizedTempRoot;
let ownedRoot;
let ownedRootIdentity;
let buildRoot;
let filesystemRoot;
let normalBuild;
let queryFailureBuild;
let cleanupCompleted = false;
let workerRequestSequence = 0;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertPlainObject(value) {
  assert.equal(value !== null && typeof value === 'object', true);
  assert.equal(Array.isArray(value), false);
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
}

function assertExactKeys(value, expectedKeys) {
  assertPlainObject(value);
  assert.deepEqual(Object.keys(value), expectedKeys);
}

function validateWorkerPath(value) {
  assert.equal(typeof value, 'string');
  assert.equal(value.length > 0, true);
  assert.equal(value.length <= 32_767, true);
  assert.equal(value.includes('\u0000'), false);
  assert.equal(path.isAbsolute(value), true);
  return value;
}

function parseCanonicalWorkerRequest() {
  assert.equal(process.argv.length, 4);
  const serialized = process.argv[3];
  assert.equal(typeof serialized, 'string');
  assert.equal(Buffer.byteLength(serialized, 'utf8') > 0, true);
  assert.equal(
    Buffer.byteLength(serialized, 'utf8') <= MAX_WORKER_REQUEST_BYTES,
    true,
  );

  const request = JSON.parse(serialized);
  assertPlainObject(request);
  assert.equal(JSON.stringify(request), serialized);
  assert.equal(
    /^moxley-native-[0-9]{4}$/.test(request.requestId),
    true,
  );
  assert.equal(WORKER_OPERATIONS.has(request.operation), true);

  const expectedKeys = request.operation === 'classify'
    ? ['requestId', 'operation', 'addonPath', 'targetPath']
    : ['requestId', 'operation', 'addonPath'];
  assertExactKeys(request, expectedKeys);
  validateWorkerPath(request.addonPath);
  if (request.operation === 'classify') {
    validateWorkerPath(request.targetPath);
  }
  return request;
}

function loadWorkerAddon(addonPath) {
  const addon = require(addonPath);
  assert.deepEqual(Object.keys(addon).sort(), ['classify']);
  assert.equal(typeof addon.classify, 'function');
  return addon;
}

function workerInputContract(addon) {
  const attempts = [
    () => addon.classify(),
    () => addon.classify('one', 'two'),
    () => addon.classify(1),
    () => addon.classify(new String('boxed')),
    () => addon.classify('embedded\u0000nul'),
    () => addon.classify(''),
    () => addon.classify('a'.repeat(32_768)),
  ];
  return attempts.map((attempt) => {
    try {
      attempt();
      return null;
    } catch (error) {
      return error.name;
    }
  });
}

function boundedWorkerErrorField(error, field) {
  const value = error[field];
  assert.equal(typeof value, 'string');
  assert.equal(value.length > 0, true);
  assert.equal(value.length <= MAX_WORKER_ERROR_FIELD_LENGTH, true);
  return value;
}

async function runNativeWorker() {
  const request = parseCanonicalWorkerRequest();
  let response;

  if (request.operation === 'expect-load-error') {
    let loadError = null;
    try {
      require(request.addonPath);
    } catch (error) {
      loadError = error;
    }
    assert.equal(loadError !== null && typeof loadError === 'object', true);
    response = {
      requestId: request.requestId,
      operation: request.operation,
      status: 'load-error',
      errorName: boundedWorkerErrorField(loadError, 'name'),
      errorCode: boundedWorkerErrorField(loadError, 'code'),
    };
  } else {
    const addon = loadWorkerAddon(request.addonPath);
    if (request.operation === 'load') {
      response = {
        requestId: request.requestId,
        operation: request.operation,
        status: 'loaded',
      };
    } else if (request.operation === 'input-contract') {
      response = {
        requestId: request.requestId,
        operation: request.operation,
        results: workerInputContract(addon),
      };
    } else {
      const result = addon.classify(request.targetPath);
      assertResultWire(result);
      response = {
        requestId: request.requestId,
        operation: request.operation,
        result,
      };
    }
  }

  const output = `${JSON.stringify(response)}\n`;
  await new Promise((resolve, reject) => {
    process.stdout.write(output, (error) => {
      if (error === null || error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}

function processResult(file, arguments_, options = {}) {
  return new Promise((resolve) => {
    execFile(
      file,
      arguments_,
      {
        cwd: options.cwd,
        encoding: 'utf8',
        env: options.env,
        maxBuffer: MAX_PROCESS_OUTPUT_BYTES,
        shell: false,
        timeout: options.timeout ?? PROCESS_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        resolve({
          error,
          stdout,
          stderr,
        });
      },
    );
  });
}

function workerProcessResult(serializedRequest) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [__filename, WORKER_ARGUMENT, serializedRequest],
      {
        cwd: ownedRoot,
        env: {},
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    const stdoutChunks = [];
    const stderrChunks = [];
    let outputBytes = 0;
    let outputExceeded = false;
    let spawnError = null;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, WORKER_TIMEOUT_MS);

    function collect(chunks, chunk) {
      outputBytes += chunk.length;
      if (outputBytes > MAX_PROCESS_OUTPUT_BYTES) {
        outputExceeded = true;
        child.kill();
        return;
      }
      chunks.push(chunk);
    }

    child.stdout.on('data', (chunk) => collect(stdoutChunks, chunk));
    child.stderr.on('data', (chunk) => collect(stderrChunks, chunk));
    child.once('error', (error) => {
      spawnError = error;
    });
    child.once('close', (exitCode, signal) => {
      clearTimeout(timeout);
      resolve({
        exitCode,
        outputExceeded,
        signal,
        spawnError,
        stderr: Buffer.concat(stderrChunks),
        stdout: Buffer.concat(stdoutChunks),
        timedOut,
      });
    });
  });
}

function assertWorkerResponseShape(response, request) {
  const expectedKeys = request.operation === 'classify'
    ? ['requestId', 'operation', 'result']
    : request.operation === 'input-contract'
      ? ['requestId', 'operation', 'results']
      : request.operation === 'expect-load-error'
        ? [
            'requestId',
            'operation',
            'status',
            'errorName',
            'errorCode',
          ]
      : ['requestId', 'operation', 'status'];
  assertExactKeys(response, expectedKeys);
  assert.equal(response.requestId, request.requestId);
  assert.equal(response.operation, request.operation);

  if (request.operation === 'classify') {
    assertResultWire(response.result);
  } else if (request.operation === 'input-contract') {
    assert.equal(Array.isArray(response.results), true);
  } else {
    assert.equal(
      response.status,
      request.operation === 'load' ? 'loaded' : 'load-error',
    );
    if (request.operation === 'expect-load-error') {
      boundedWorkerErrorField(response, 'errorName');
      boundedWorkerErrorField(response, 'errorCode');
    }
  }
}

async function requestWorker(operation, selectedAddonPath, targetPath) {
  assert.equal(WORKER_OPERATIONS.has(operation), true);
  workerRequestSequence += 1;
  assert.equal(workerRequestSequence <= 9_999, true);
  const request = {
    requestId: `moxley-native-${String(workerRequestSequence).padStart(4, '0')}`,
    operation,
    addonPath: validateWorkerPath(selectedAddonPath),
  };
  if (operation === 'classify') {
    request.targetPath = validateWorkerPath(targetPath);
  } else {
    assert.equal(targetPath, undefined);
  }
  const serializedRequest = JSON.stringify(request);
  assert.equal(
    Buffer.byteLength(serializedRequest, 'utf8') <= MAX_WORKER_REQUEST_BYTES,
    true,
  );

  const run = await workerProcessResult(serializedRequest);
  assert.equal(run.spawnError, null);
  assert.equal(run.timedOut, false);
  assert.equal(run.outputExceeded, false);
  assert.equal(run.signal, null);
  assert.equal(run.exitCode, 0);
  assert.equal(run.stderr.length, 0);
  assert.equal(run.stdout.length > 1, true);

  const stdout = new TextDecoder('utf-8', { fatal: true }).decode(run.stdout);
  assert.equal(stdout.endsWith('\n'), true);
  assert.equal(stdout.includes('\r'), false);
  assert.equal(stdout.slice(0, -1).includes('\n'), false);
  const serializedResponse = stdout.slice(0, -1);
  assert.equal(serializedResponse.length > 0, true);
  const response = JSON.parse(serializedResponse);
  assert.equal(JSON.stringify(response), serializedResponse);
  assertWorkerResponseShape(response, request);
  return response;
}

function errorCode(error) {
  return typeof error?.code === 'string' ? error.code : 'NO_CODE';
}

async function requireProcessSuccess(label, file, arguments_, options) {
  const result = await processResult(file, arguments_, options);
  assert.equal(result.error, null, `${label} must exit successfully`);
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    /\bwarning\b/i,
    `${label} must emit no warning`,
  );
  return result;
}

async function requireErrorCode(label, operation, expectedCode) {
  try {
    await operation();
  } catch (error) {
    assert.equal(
      errorCode(error),
      expectedCode,
      `${label} must expose ${expectedCode}`,
    );
    return;
  }

  assert.fail(`${label} must fail`);
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

function assertOwnedRootSafety(candidate) {
  assert.equal(typeof candidate, 'string');
  assert.equal(path.isAbsolute(candidate), true);

  const resolved = path.resolve(candidate);
  const home = path.resolve(os.homedir());
  const workingDirectory = path.resolve(process.cwd());
  const driveRoot = path.parse(resolved).root;

  assert.equal(isStrictDescendant(normalizedTempRoot, resolved), true);
  assert.equal(path.dirname(resolved), normalizedTempRoot);
  assert.equal(path.basename(resolved).startsWith(TASK_PREFIX), true);
  assert.notEqual(resolved, normalizedTempRoot);
  assert.notEqual(resolved, REPOSITORY_ROOT);
  assert.notEqual(resolved, workingDirectory);
  assert.notEqual(resolved, home);
  assert.notEqual(resolved, driveRoot);
}

async function authenticateRegularFile(
  target,
  expectedLength,
  expectedHash,
) {
  const metadata = await lstat(target);
  assert.equal(metadata.isFile(), true);
  assert.equal(metadata.isSymbolicLink(), false);
  const bytes = await readFile(target);
  assert.equal(bytes.length, expectedLength);
  assert.equal(sha256(bytes), expectedHash);
}

async function authenticateToolchain() {
  assert.equal(process.platform, 'win32');
  assert.equal(process.arch, 'x64');
  assert.equal(process.version, 'v24.13.0');
  assert.equal(process.versions.modules, '137');
  assert.equal(process.versions.napi, '10');

  for (const target of [VS_DEV_CMD, CL_EXE, LINK_EXE, NATIVE_SOURCE]) {
    const metadata = await lstat(target);
    assert.equal(metadata.isFile(), true);
    assert.equal(metadata.isSymbolicLink(), false);
  }

  for (
    const directory of [
      MSVC_INCLUDE,
      MSVC_LIB,
      path.join(WINDOWS_SDK_INCLUDE, 'ucrt'),
      path.join(WINDOWS_SDK_INCLUDE, 'shared'),
      path.join(WINDOWS_SDK_INCLUDE, 'um'),
      path.join(WINDOWS_SDK_LIB, 'ucrt', 'x64'),
      path.join(WINDOWS_SDK_LIB, 'um', 'x64'),
    ]
  ) {
    const metadata = await lstat(directory);
    assert.equal(metadata.isDirectory(), true);
    assert.equal(metadata.isSymbolicLink(), false);
  }

  for (const headerName of REQUIRED_NODE_HEADERS) {
    const header = path.join(NODE_INCLUDE, headerName);
    const metadata = await lstat(header);
    assert.equal(metadata.isFile(), true);
    assert.equal(metadata.isSymbolicLink(), false);
  }

  const versionHeader = await readFile(
    path.join(NODE_INCLUDE, 'node_version.h'),
    'utf8',
  );
  assert.match(versionHeader, /^#define NODE_MAJOR_VERSION 24$/m);
  assert.match(versionHeader, /^#define NODE_MINOR_VERSION 13$/m);
  assert.match(versionHeader, /^#define NODE_PATCH_VERSION 0$/m);
  assert.match(versionHeader, /^#define NODE_MODULE_VERSION 137$/m);

  await authenticateRegularFile(
    NODE_LIB,
    EXPECTED_NODE_LIB.byteLength,
    EXPECTED_NODE_LIB.sha256,
  );
  await authenticateRegularFile(
    KERNEL32_LIB,
    EXPECTED_KERNEL32.byteLength,
    EXPECTED_KERNEL32.sha256,
  );

  const sdkHeaders = [
    path.join(WINDOWS_SDK_INCLUDE, 'um', 'fileapi.h'),
    path.join(WINDOWS_SDK_INCLUDE, 'um', 'WinBase.h'),
    path.join(WINDOWS_SDK_INCLUDE, 'um', 'winnt.h'),
  ];
  const sdkText = (
    await Promise.all(sdkHeaders.map((header) => readFile(header, 'utf8')))
  ).join('\n');
  for (const token of REQUIRED_SDK_TOKENS) {
    assert.equal(sdkText.includes(token), true);
  }

  receipt.windowsSdk = WINDOWS_SDK_VERSION;
  receipt.nodeInputs = 'confirmed';
}

function quoteResponseArgument(value) {
  assert.equal(value.includes('"'), false);
  return `"${value}"`;
}

function createBuildVariant(baseName, forceQueryFailure) {
  const variant = {
    addonPath: path.join(buildRoot, `${baseName}.node`),
    compileResponse: path.join(buildRoot, `${baseName}-compile.rsp`),
    forceQueryFailure,
    importLibraryPath: path.join(buildRoot, `${baseName}.lib`),
    linkResponse: path.join(buildRoot, `${baseName}-link.rsp`),
    objectPath: path.join(buildRoot, `${baseName}.obj`),
    pdbPath: path.join(buildRoot, `${baseName}.pdb`),
  };
  for (const outputPath of Object.values(variant)) {
    if (typeof outputPath === 'string') {
      assert.equal(isStrictDescendant(buildRoot, outputPath), true);
    }
  }
  return variant;
}

async function writeBuildResponses(variant) {
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
    ...(variant.forceQueryFailure
      ? ['/DMOXLEY_TEST_FORCE_ATTRIBUTE_QUERY_FAILURE=1']
      : []),
    `/I${quoteResponseArgument(NODE_INCLUDE)}`,
    `/Fo${quoteResponseArgument(variant.objectPath)}`,
    quoteResponseArgument(NATIVE_SOURCE),
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
    `/OUT:${quoteResponseArgument(variant.addonPath)}`,
    `/IMPLIB:${quoteResponseArgument(variant.importLibraryPath)}`,
    `/PDB:${quoteResponseArgument(variant.pdbPath)}`,
    quoteResponseArgument(variant.objectPath),
    quoteResponseArgument(NODE_LIB),
    quoteResponseArgument(KERNEL32_LIB),
  ];

  await writeFile(
    variant.compileResponse,
    `${compileArguments.join('\r\n')}\r\n`,
    'utf8',
  );
  await writeFile(
    variant.linkResponse,
    `${linkArguments.join('\r\n')}\r\n`,
    'utf8',
  );
}

async function buildAddonVariant(variant, label, buildEnvironment) {
  await writeBuildResponses(variant);
  const compileResult = await requireProcessSuccess(
    `${label} native compilation`,
    CL_EXE,
    [`@${variant.compileResponse}`],
    { cwd: buildRoot, env: buildEnvironment },
  );
  assert.match(
    `${compileResult.stdout}\n${compileResult.stderr}`,
    /Compiler Version 19\.44\.35228 for x64/,
  );

  const linkResult = await requireProcessSuccess(
    `${label} native linking`,
    LINK_EXE,
    [`@${variant.linkResponse}`],
    { cwd: buildRoot, env: buildEnvironment },
  );
  assert.match(
    `${linkResult.stdout}\n${linkResult.stderr}`,
    /Incremental Linker Version 14\.44\.35228\.0/,
  );

  const addonMetadata = await lstat(variant.addonPath);
  assert.equal(addonMetadata.isFile(), true);
  assert.equal(addonMetadata.isSymbolicLink(), false);
}

async function buildAddons() {
  const buildEnvironment = {
    ...process.env,
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
    PATH: `${MSVC_BIN};${process.env.PATH}`,
  };

  normalBuild = createBuildVariant(
    'windows-reparse-classifier',
    false,
  );
  queryFailureBuild = createBuildVariant(
    'windows-reparse-classifier-query-failure',
    true,
  );

  await buildAddonVariant(normalBuild, 'normal', buildEnvironment);
  await buildAddonVariant(
    queryFailureBuild,
    'injected query-failure',
    buildEnvironment,
  );

  assert.notEqual(normalBuild.objectPath, queryFailureBuild.objectPath);
  assert.notEqual(normalBuild.addonPath, queryFailureBuild.addonPath);
  assert.notEqual(
    normalBuild.importLibraryPath,
    queryFailureBuild.importLibraryPath,
  );
  assert.notEqual(normalBuild.pdbPath, queryFailureBuild.pdbPath);
  assert.notEqual(
    normalBuild.compileResponse,
    queryFailureBuild.compileResponse,
  );
  assert.notEqual(normalBuild.linkResponse, queryFailureBuild.linkResponse);

  receipt.compiler = '19.44.35228.0 x64';
  receipt.linker = '14.44.35228.0 x64';
  receipt.build.normal = 'confirmed';
  receipt.build.queryFailure = 'confirmed';

  const normalCompileResponse = await readFile(
    normalBuild.compileResponse,
    'utf8',
  );
  const queryFailureCompileResponse = await readFile(
    queryFailureBuild.compileResponse,
    'utf8',
  );
  assert.match(
    queryFailureCompileResponse,
    /^\/DMOXLEY_TEST_FORCE_ATTRIBUTE_QUERY_FAILURE=1$/m,
  );
  assert.doesNotMatch(
    normalCompileResponse,
    /MOXLEY_TEST_FORCE_ATTRIBUTE_QUERY_FAILURE/,
  );

  const emitted = await enumerateFiles(buildRoot);
  for (const emittedPath of emitted) {
    assert.equal(isStrictDescendant(buildRoot, emittedPath), true);
  }
}

async function enumerateFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await enumerateFiles(entryPath));
    } else {
      files.push(entryPath);
    }
  }
  return files;
}

function assertResultWire(result) {
  assert.deepEqual(Object.keys(result), EXPECTED_RESULT_KEYS);
  assert.equal(
    ['ordinary', 'reparse', 'capability-gap'].includes(result.outcome),
    true,
  );
  for (
    const field of [
      'fileAttributes',
      'reparseTag',
      'win32Error',
      'closeWin32Error',
    ]
  ) {
    assert.equal(Number.isInteger(result[field]), true);
    assert.equal(result[field] >= 0, true);
    assert.equal(result[field] <= 0xffffffff, true);
  }
}

function assertNoClassificationFields(response) {
  for (const field of ['result', ...EXPECTED_RESULT_KEYS]) {
    assert.equal(field in response, false);
  }
}

async function invokeProbe(target, selectedAddonPath = normalBuild.addonPath) {
  const response = await requestWorker(
    'classify',
    selectedAddonPath,
    target,
  );
  return response.result;
}

async function attemptSymlink(target, alias, type) {
  try {
    await symlink(target, alias, type);
  } catch (error) {
    const code = errorCode(error);
    assert.equal(OPTIONAL_SYMLINK_GAP_CODES.has(code), true);
    receipt.symbolicLinks.push({ type, status: 'capability-gap', code });
    return;
  }

  const result = await invokeProbe(alias);
  assert.equal(result.outcome, 'reparse');
  assert.notEqual(result.fileAttributes & REPARSE_ATTRIBUTE, 0);
  assert.notEqual(result.reparseTag, 0);
  assert.equal(result.win32Error, 0);
  assert.equal(result.closeWin32Error, 0);
  receipt.symbolicLinks.push({ type, status: 'confirmed' });

  await unlink(alias);
  await requireErrorCode('symbolic-link absence', () => lstat(alias), 'ENOENT');
  const targetMetadata = await lstat(target);
  assert.equal(
    type === 'dir'
      ? targetMetadata.isDirectory()
      : targetMetadata.isFile(),
    true,
  );
}

async function removeOwnedRoot() {
  assertOwnedRootSafety(ownedRoot);
  const metadata = await lstat(ownedRoot, { bigint: true });
  assert.equal(metadata.isDirectory(), true);
  assert.equal(metadata.isSymbolicLink(), false);
  assert.equal(metadata.dev, ownedRootIdentity.dev);
  assert.equal(metadata.ino, ownedRootIdentity.ino);

  if (normalBuild !== undefined) {
    const addonMetadata = await lstat(normalBuild.addonPath).catch(() => null);
    if (addonMetadata !== null) {
      const rootResult = await invokeProbe(ownedRoot);
      assert.equal(rootResult.outcome, 'ordinary');
    }
  }

  await rm(ownedRoot, {
    recursive: true,
    force: false,
    maxRetries: 3,
    retryDelay: 50,
  });
  await requireErrorCode(
    'owned root cleanup confirmation',
    () => lstat(ownedRoot),
    'ENOENT',
  );
  cleanupCompleted = true;
  receipt.cleanup = 'confirmed';
}

if (IS_WORKER_MODE) {
  void runNativeWorker().catch(() => {
    process.exitCode = 1;
  });
} else {
describe(
  'native Windows reparse classification characterization',
  { concurrency: false },
  () => {
    before(async () => {
      await authenticateToolchain();
      normalizedTempRoot = path.resolve(os.tmpdir());
      ownedRoot = await mkdtemp(path.join(os.tmpdir(), TASK_PREFIX));
      assertOwnedRootSafety(ownedRoot);
      ownedRootIdentity = await lstat(ownedRoot, { bigint: true });
      assert.equal(ownedRootIdentity.isDirectory(), true);
      assert.equal(ownedRootIdentity.isSymbolicLink(), false);

      buildRoot = path.join(ownedRoot, 'build');
      filesystemRoot = path.join(ownedRoot, 'filesystem');
      await mkdir(buildRoot);
      await mkdir(filesystemRoot);
      await buildAddons();
    });

    after(async () => {
      if (ownedRoot === undefined || cleanupCompleted) {
        return;
      }
      await removeOwnedRoot();
    });

    it(
      'test-only Node-API probe builds and loads from the exact offline approved toolchain',
      async () => {
        const normalLoad = await requestWorker(
          'load',
          normalBuild.addonPath,
        );
        assert.equal(normalLoad.status, 'loaded');
        const queryFailureLoad = await requestWorker(
          'load',
          queryFailureBuild.addonPath,
        );
        assert.equal(queryFailureLoad.status, 'loaded');
        assert.equal(receipt.compiler, '19.44.35228.0 x64');
        assert.equal(receipt.linker, '14.44.35228.0 x64');
        assert.equal(receipt.windowsSdk, WINDOWS_SDK_VERSION);
        assert.equal(receipt.nodeInputs, 'confirmed');
        assert.equal(receipt.build.normal, 'confirmed');
        assert.equal(receipt.build.queryFailure, 'confirmed');

        const inputResponse = await requestWorker(
          'input-contract',
          normalBuild.addonPath,
        );
        assert.deepEqual(
          inputResponse.results,
          [
            'TypeError',
            'TypeError',
            'TypeError',
            'TypeError',
            'TypeError',
            'RangeError',
            'RangeError',
          ],
        );
        receipt.load = 'confirmed';
      },
    );

    it(
      'native probe classifies ordinary files and directories without reparse attributes',
      async () => {
        const ordinaryFile = path.join(filesystemRoot, 'ordinary-file');
        const ordinaryDirectory = path.join(
          filesystemRoot,
          'ordinary-directory',
        );
        await writeFile(ordinaryFile, 'ordinary', 'utf8');
        await mkdir(ordinaryDirectory);

        for (const target of [ordinaryFile, ordinaryDirectory]) {
          const result = await invokeProbe(target);
          assert.equal(result.outcome, 'ordinary');
          assert.equal(result.fileAttributes & REPARSE_ATTRIBUTE, 0);
          assert.equal(result.reparseTag, 0);
          assert.equal(result.win32Error, 0);
          assert.equal(result.closeWin32Error, 0);
        }

        const renamedFile = `${ordinaryFile}-renamed`;
        const renamedDirectory = `${ordinaryDirectory}-renamed`;
        await rename(ordinaryFile, renamedFile);
        await rename(ordinaryDirectory, renamedDirectory);
        await rename(renamedFile, ordinaryFile);
        await rename(renamedDirectory, ordinaryDirectory);
        receipt.ordinary = 'confirmed';
      },
    );

    it(
      'native probe classifies a task-owned junction as a reparse point',
      async () => {
        const target = path.join(filesystemRoot, 'junction-target');
        const alias = path.join(filesystemRoot, 'junction-alias');
        await mkdir(target);
        await symlink(target, alias, 'junction');

        const result = await invokeProbe(alias);
        assert.equal(result.outcome, 'reparse');
        assert.notEqual(result.fileAttributes & REPARSE_ATTRIBUTE, 0);
        assert.notEqual(result.reparseTag, 0);
        assert.equal(result.win32Error, 0);
        assert.equal(result.closeWin32Error, 0);

        await unlink(alias);
        await requireErrorCode('junction absence', () => lstat(alias), 'ENOENT');
        assert.equal((await lstat(target)).isDirectory(), true);
        receipt.junction = 'confirmed';
      },
    );

    it(
      'native probe keeps task-owned hard links distinct from reparse classification',
      async () => {
        const source = path.join(filesystemRoot, 'hard-link-source');
        const alias = path.join(filesystemRoot, 'hard-link-alias');
        await writeFile(source, 'hard-link', 'utf8');
        await link(source, alias);

        for (const target of [source, alias]) {
          const result = await invokeProbe(target);
          assert.equal(result.outcome, 'ordinary');
          assert.equal(result.fileAttributes & REPARSE_ATTRIBUTE, 0);
          assert.equal(result.reparseTag, 0);
        }

        const sourceMetadata = await lstat(source, { bigint: true });
        const aliasMetadata = await lstat(alias, { bigint: true });
        assert.equal(sourceMetadata.nlink >= 2n, true);
        assert.equal(sourceMetadata.dev, aliasMetadata.dev);
        assert.equal(sourceMetadata.ino, aliasMetadata.ino);

        await unlink(alias);
        await requireErrorCode(
          'hard-link alias absence',
          () => lstat(alias),
          'ENOENT',
        );
        assert.equal((await lstat(source)).isFile(), true);
        receipt.hardLink = 'confirmed';
      },
    );

    it(
      'native probe classifies permitted symbolic links or records the exact creation capability gap',
      async () => {
        const fileTarget = path.join(filesystemRoot, 'symlink-file-target');
        const fileAlias = path.join(filesystemRoot, 'symlink-file-alias');
        const directoryTarget = path.join(
          filesystemRoot,
          'symlink-directory-target',
        );
        const directoryAlias = path.join(
          filesystemRoot,
          'symlink-directory-alias',
        );
        await writeFile(fileTarget, 'symlink-file', 'utf8');
        await mkdir(directoryTarget);

        await attemptSymlink(fileTarget, fileAlias, 'file');
        await attemptSymlink(directoryTarget, directoryAlias, 'dir');
        assert.equal(receipt.symbolicLinks.length, 2);
      },
    );

    it(
      'native probe fails closed for absent objects and injected attribute-query failure',
      async () => {
        const absent = path.join(filesystemRoot, 'absent-object');
        await requireErrorCode(
          'absent-object precondition',
          () => lstat(absent),
          'ENOENT',
        );
        const result = await invokeProbe(absent);
        assert.equal(result.outcome, 'capability-gap');
        assert.equal(result.fileAttributes, 0);
        assert.equal(result.reparseTag, 0);
        assert.notEqual(result.win32Error, 0);
        assert.equal(result.closeWin32Error, 0);
        receipt.absentObject = 'confirmed';

        const queryFailureTarget = path.join(
          filesystemRoot,
          'query-failure-target',
        );
        await writeFile(queryFailureTarget, 'query-failure', 'utf8');
        const queryFailureResult = await invokeProbe(
          queryFailureTarget,
          queryFailureBuild.addonPath,
        );
        assert.deepEqual(queryFailureResult, {
          outcome: 'capability-gap',
          fileAttributes: 0,
          reparseTag: 0,
          win32Error: 31,
          closeWin32Error: 0,
        });
        const renamedQueryFailureTarget = `${queryFailureTarget}-renamed`;
        await rename(queryFailureTarget, renamedQueryFailureTarget);
        await unlink(renamedQueryFailureTarget);
        await requireErrorCode(
          'query-failure target absence',
          () => lstat(renamedQueryFailureTarget),
          'ENOENT',
        );
        receipt.injectedQueryFailure = 'confirmed';
      },
    );

    it(
      'missing or malformed addon loads never yield a classification',
      async () => {
        const missing = path.join(buildRoot, 'missing.node');
        const malformed = path.join(buildRoot, 'malformed.node');
        const missingResponse = await requestWorker(
          'expect-load-error',
          missing,
        );
        const missingObservation = {
          status: missingResponse.status,
          errorName: missingResponse.errorName,
          errorCode: missingResponse.errorCode,
        };
        assert.deepEqual(missingObservation, {
          status: 'load-error',
          errorName: 'Error',
          errorCode: 'MODULE_NOT_FOUND',
        });
        assertNoClassificationFields(missingResponse);

        await writeFile(malformed, 'not-a-native-addon', 'utf8');
        const malformedResponse = await requestWorker(
          'expect-load-error',
          malformed,
        );
        const malformedObservation = {
          status: malformedResponse.status,
          errorName: malformedResponse.errorName,
          errorCode: malformedResponse.errorCode,
        };
        assert.deepEqual(malformedObservation, {
          status: 'load-error',
          errorName: 'Error',
          errorCode: 'ERR_DLOPEN_FAILED',
        });
        assertNoClassificationFields(malformedResponse);
        await unlink(malformed);
        await requireErrorCode(
          'malformed addon absence',
          () => lstat(malformed),
          'ENOENT',
        );
        receipt.loadErrors.missing = {
          name: missingResponse.errorName,
          code: missingResponse.errorCode,
        };
        receipt.loadErrors.malformed = {
          name: malformedResponse.errorName,
          code: malformedResponse.errorCode,
        };
      },
    );

    it(
      'native probe closes handles and removes every task-owned build and filesystem path',
      async () => {
        for (
          const selectedAddonPath of [
            normalBuild.addonPath,
            queryFailureBuild.addonPath,
          ]
        ) {
          const renamedAddon = `${selectedAddonPath}.renamed`;
          await rename(selectedAddonPath, renamedAddon);
          await rename(renamedAddon, selectedAddonPath);
        }

        assert.equal(receipt.load, 'confirmed');
        assert.equal(receipt.ordinary, 'confirmed');
        assert.equal(receipt.junction, 'confirmed');
        assert.equal(receipt.hardLink, 'confirmed');
        assert.equal(receipt.absentObject, 'confirmed');
        assert.equal(receipt.injectedQueryFailure, 'confirmed');
        assert.deepEqual(receipt.loadErrors, {
          missing: {
            name: 'Error',
            code: 'MODULE_NOT_FOUND',
          },
          malformed: {
            name: 'Error',
            code: 'ERR_DLOPEN_FAILED',
          },
        });
        assert.equal(receipt.overallQualification, 'no-go');

        await removeOwnedRoot();
        assert.equal(receipt.cleanup, 'confirmed');
        assert.equal(receipt.overallQualification, 'no-go');

        console.log(JSON.stringify({
          nativeReparseCharacterizationReceipt: receipt,
        }));
      },
    );
  },
);
}
