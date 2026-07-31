'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
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
const PROCESS_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const sandboxRoots = new Set();
let repositoryBuildOwned = false;
let liveServer = null;
let liveLockOwned = false;

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

function runProcess(file, arguments_, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, arguments_, {
      cwd: options.cwd,
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    let stdoutLength = 0;
    let stderrLength = 0;
    let settled = false;
    const timeout = setTimeout(() => child.kill(), PROCESS_TIMEOUT_MS);
    child.once('error', reject);
    child.stdout.on('data', (chunk) => {
      stdoutLength += chunk.length;
      if (stdoutLength > MAX_OUTPUT_BYTES) child.kill();
      else stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderrLength += chunk.length;
      if (stderrLength > MAX_OUTPUT_BYTES) child.kill();
      else stderr.push(chunk);
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (stdoutLength > MAX_OUTPUT_BYTES || stderrLength > MAX_OUTPUT_BYTES) {
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
  });
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
  assert.equal(result.code, 0);
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
    });

    after(async () => {
      if (liveServer !== null) {
        await closeServer(liveServer);
        liveServer = null;
      }
      if (liveLockOwned && (await exists(LOCK))) {
        await fsp.unlink(LOCK);
        liveLockOwned = false;
      }
      if (repositoryBuildOwned) {
        const cleanup = await runNodeScript(CLEAN_SCRIPT);
        assert.equal(cleanup.code, 0);
        assert.equal(cleanup.stderr.length, 0);
        repositoryBuildOwned = false;
      }
      for (const root of [...sandboxRoots]) await removeSandbox(root);
      await assertRepositoryGeneratedStateAbsent();
    });

    it(
      'production native source is the single characterized classifier authority',
      async () => {
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
        assert.equal(result.code, 0);
        assert.equal(result.signal, null);
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
        const sandbox = await createSandbox();
        const result = await buildTest.exercisePromotionScenario(
          sandbox,
          'pre',
        );
        assert.equal(result.failed, true);
        assert.equal(result.code, 'MOXLEY_NATIVE_BUILD_INJECTED_FAILURE');
        assert.equal(result.observations.leaseClosed, true);
        assert.equal(await exists(result.paths.artifact), false);
        assert.equal(await exists(result.paths.receipt), false);
        assert.equal(await exists(result.paths.staging), false);
        assert.equal(await exists(result.paths.lock), false);
        await removeSandbox(sandbox);
      },
    );

    it(
      'handled post-promotion failure preserves generated evidence for explicit clean',
      async () => {
        const sandbox = await createSandbox();
        const result = await buildTest.exercisePromotionScenario(
          sandbox,
          'post',
        );
        assert.equal(result.failed, true);
        assert.equal(result.code, 'MOXLEY_NATIVE_BUILD_INJECTED_FAILURE');
        assert.equal(result.observations.leaseClosed, true);
        assert.equal(await exists(result.paths.artifact), true);
        assert.equal(await exists(result.paths.receipt), false);
        assert.equal(await exists(result.paths.staging), true);
        assert.equal(await exists(result.paths.lock), true);
        await removeSandbox(sandbox);
      },
    );

    it(
      'explicit native clean removes only authenticated generated state and is idempotent',
      async () => {
        assertBoundedFailure(
          await runNodeScript(CLEAN_SCRIPT, ['unexpected']),
        );
        const clean = await runNodeScript(CLEAN_SCRIPT);
        assert.equal(clean.code, 0);
        assert.equal(clean.signal, null);
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
        assert.equal(second.code, 0);
        assert.equal(second.signal, null);
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
