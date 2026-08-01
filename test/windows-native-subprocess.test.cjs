'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const WORKER_FLAG = '--moxley-native-subprocess-worker';
const TIMEOUT_WORKER_NATURAL_MS = 2_000;
const DIRECT_WORKER_NATURAL_MS = 7_000;
const DESCENDANT_HOLD_MS = 8_000;
const INHERITED_PIPE_TIMEOUT_MS = 3_000;

function canonicalJson(value) {
  return `${JSON.stringify(value)}\n`;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function writeBounded(stream, value) {
  return new Promise((resolve, reject) => {
    stream.write(value, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function runWorker(mode) {
  if (process.argv.length !== 4 || process.argv[2] !== WORKER_FLAG) {
    throw new Error('WORKER_ARGUMENTS_INVALID');
  }

  if (mode === 'ordinary') {
    await writeBounded(
      process.stdout,
      canonicalJson({ status: 'ordinary', evidence: 'bounded' }),
    );
    await writeBounded(process.stderr, 'bounded-stderr\n');
    return;
  }

  if (mode === 'nonzero') {
    process.exitCode = 23;
    return;
  }

  if (mode === 'timeout') {
    await delay(TIMEOUT_WORKER_NATURAL_MS);
    return;
  }

  if (mode === 'overflow-stdout' || mode === 'overflow-stderr') {
    const buildModule = require('../scripts/build-windows-native.cjs');
    const bytes = Buffer.alloc(
      buildModule.__test.MAX_PROCESS_OUTPUT_BYTES + 1,
      0x78,
    );
    const stream = mode === 'overflow-stdout' ? process.stdout : process.stderr;
    await writeBounded(stream, bytes);
    return;
  }

  if (mode === 'inherited-descendant') {
    await delay(DESCENDANT_HOLD_MS);
    await writeBounded(
      process.stdout,
      canonicalJson({ status: 'descendant-finished' }),
    );
    return;
  }

  if (mode === 'inherited-direct') {
    const descendant = spawn(
      process.execPath,
      [__filename, WORKER_FLAG, 'inherited-descendant'],
      {
        detached: true,
        shell: false,
        stdio: ['ignore', 'inherit', 'inherit'],
        windowsHide: true,
      },
    );
    await new Promise((resolve, reject) => {
      descendant.once('error', reject);
      descendant.once('spawn', resolve);
    });
    descendant.unref();
    await writeBounded(
      process.stdout,
      canonicalJson({ status: 'descendant-started' }),
    );
    await delay(DIRECT_WORKER_NATURAL_MS);
    return;
  }

  throw new Error('WORKER_MODE_INVALID');
}

if (process.argv[2] === WORKER_FLAG) {
  runWorker(process.argv[3]).catch(() => {
    process.exitCode = 97;
  });
} else {
  const { performance } = require('node:perf_hooks');
  const { after, test } = require('node:test');
  const buildModule = require('../scripts/build-windows-native.cjs');
  const buildTest = buildModule.__test;
  const temporaryRoots = new Set();

  function workerArguments(mode) {
    return [__filename, WORKER_FLAG, mode];
  }

  async function captureError(promise) {
    try {
      await promise;
    } catch (error) {
      return error;
    }
    assert.fail('Expected the subprocess operation to fail.');
  }

  function assertBuildError(error, message) {
    assert.equal(error.name, 'NativeBuildError');
    assert.equal(error.code, 'MOXLEY_NATIVE_BUILD_SUBPROCESS_FAILED');
    assert.equal(error.message, message);
  }

  function sameIdentity(left, right) {
    return left.dev === right.dev && left.ino === right.ino;
  }

  async function withAuthenticatedTemporaryDirectory(action) {
    const canonicalTemporaryRoot = await fsp.realpath(os.tmpdir());
    const root = await fsp.mkdtemp(
      path.join(canonicalTemporaryRoot, 'moxley-native-subprocess-'),
    );
    temporaryRoots.add(root);
    const initial = await fsp.lstat(root, { bigint: true });
    assert.equal(initial.isDirectory(), true);
    assert.equal(initial.isSymbolicLink(), false);
    assert.equal(
      path.resolve(await fsp.realpath(root)).toLowerCase(),
      path.resolve(root).toLowerCase(),
    );
    const relative = path.relative(canonicalTemporaryRoot, root);
    assert.notEqual(relative, '');
    assert.equal(path.isAbsolute(relative), false);
    assert.equal(relative === '..' || relative.startsWith(`..${path.sep}`), false);

    try {
      return await action(root);
    } finally {
      const final = await fsp.lstat(root, { bigint: true });
      assert.equal(final.isDirectory(), true);
      assert.equal(final.isSymbolicLink(), false);
      assert.equal(sameIdentity(initial, final), true);
      assert.deepEqual(await fsp.readdir(root), []);
      await fsp.rmdir(root);
      await assert.rejects(fsp.lstat(root), { code: 'ENOENT' });
      temporaryRoots.delete(root);
    }
  }

  after(() => {
    assert.equal(temporaryRoots.size, 0);
  });

  test(
    'production subprocess supervision preserves ordinary zero-exit evidence',
    async () => {
      assert.equal(buildTest.PROCESS_TIMEOUT_MS, 30_000);
      assert.equal(buildTest.MAX_PROCESS_OUTPUT_BYTES, 2 * 1024 * 1024);
      const result = await buildTest.runProcess(
        process.execPath,
        workerArguments('ordinary'),
      );
      assert.equal(result.code, 0);
      assert.equal(result.signal, null);
      assert.equal(
        result.stdout.toString('utf8'),
        canonicalJson({ status: 'ordinary', evidence: 'bounded' }),
      );
      assert.equal(result.stderr.toString('utf8'), 'bounded-stderr\n');
    },
  );

  test(
    'production subprocess success requirement maps nonzero exit to its bounded build error',
    async () => {
      const error = await captureError(
        buildTest.requireProcessSuccess(
          'Characterized nonzero subprocess',
          process.execPath,
          workerArguments('nonzero'),
        ),
      );
      assertBuildError(error, 'Characterized nonzero subprocess failed.');
    },
  );

  test(
    'production subprocess success requirement maps spawn failure to the same bounded build code',
    async () => {
      await withAuthenticatedTemporaryDirectory(async (root) => {
        const absentExecutable = path.join(
          root,
          'absent-native-subprocess.exe',
        );
        await assert.rejects(fsp.lstat(absentExecutable), { code: 'ENOENT' });
        const error = await captureError(
          buildTest.requireProcessSuccess(
            'Characterized absent executable',
            absentExecutable,
            [],
          ),
        );
        assertBuildError(error, 'Characterized absent executable failed.');
        assert.equal(Object.hasOwn(error, 'cause'), false);
        assert.equal(Object.hasOwn(error, 'path'), false);
        assert.equal(Object.hasOwn(error, 'errno'), false);
        assert.equal(Object.hasOwn(error, 'syscall'), false);
        await assert.rejects(fsp.lstat(absentExecutable), { code: 'ENOENT' });
      });
    },
  );

  test(
    'production subprocess timeout maps to the same bounded build code',
    async () => {
      const error = await captureError(
        buildTest.requireProcessSuccess(
          'Characterized timeout subprocess',
          process.execPath,
          workerArguments('timeout'),
          { timeoutMs: 100 },
        ),
      );
      assertBuildError(error, 'Characterized timeout subprocess failed.');
    },
  );

  test(
    'production subprocess output overflow maps to the same bounded build code',
    async () => {
      for (const stream of ['stdout', 'stderr']) {
        const label = `Characterized ${stream} overflow`;
        const error = await captureError(
          buildTest.requireProcessSuccess(
            label,
            process.execPath,
            workerArguments(`overflow-${stream}`),
          ),
        );
        assertBuildError(error, `${label} failed.`);
      }
    },
  );

  test(
    'production subprocess timeout is not a true deadline while a descendant retains inherited pipes',
    async (context) => {
      const started = performance.now();
      const error = await captureError(
        buildTest.runProcess(
          process.execPath,
          workerArguments('inherited-direct'),
          { timeoutMs: INHERITED_PIPE_TIMEOUT_MS },
        ),
      );
      const elapsedMs = performance.now() - started;
      assertBuildError(error, 'A bounded native build subprocess failed.');
      assert.ok(elapsedMs >= 6_000, `settled too early: ${elapsedMs}`);
      assert.ok(elapsedMs < 20_000, `settled too late: ${elapsedMs}`);
      context.diagnostic(
        canonicalJson({
          nominalTimeoutMs: INHERITED_PIPE_TIMEOUT_MS,
          descendantNaturalLifetimeMs: DESCENDANT_HOLD_MS,
          settlementElapsedMs: Math.round(elapsedMs * 1000) / 1000,
        }).trimEnd(),
      );
    },
  );
}
