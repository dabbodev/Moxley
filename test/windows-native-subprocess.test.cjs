'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const WORKER_FLAG = '--moxley-native-subprocess-worker';
const TASK_OWNED_TREE_NATURAL_MS = 20_000;
const INHERITED_DESCENDANT_NATURAL_MS = 2_000;
const TEST_EXECUTION_TIMEOUT_MS = 1_500;
const TEST_EXIT_CLOSE_GRACE_MS = 100;
const TEST_POST_TERMINATION_GRACE_MS = 100;
const TASK_OWNED_ABSENCE_BOUND_MS = 5_000;
const WORKER_HANDSHAKE_TIMEOUT_MS = 5_000;
const TEST_CASE_TIMEOUT_MS = 30_000;

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

function waitForSpawn(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('spawn', resolve);
  });
}

function waitForPipeHeldHandshake(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('WORKER_HANDSHAKE_TIMEOUT')),
      WORKER_HANDSHAKE_TIMEOUT_MS);

    function removeListeners() {
      child.removeListener('message', onMessage);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
    }

    function finish(error) {
      clearTimeout(timer);
      removeListeners();
      if (error === null) resolve();
      else reject(error);
    }

    function onMessage(message) {
      if (
        message !== null &&
        typeof message === 'object' &&
        !Array.isArray(message) &&
        JSON.stringify(Object.keys(message)) === JSON.stringify(['status']) &&
        message.status === 'pipe-held'
      ) {
        finish(null);
      } else {
        finish(new Error('WORKER_HANDSHAKE_INVALID'));
      }
    }

    function onError() {
      finish(new Error('WORKER_HANDSHAKE_ERROR'));
    }

    function onExit() {
      finish(new Error('WORKER_HANDSHAKE_EARLY_EXIT'));
    }

    child.once('message', onMessage);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

function waitForParentDisconnect() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('PARENT_DISCONNECT_TIMEOUT')),
      WORKER_HANDSHAKE_TIMEOUT_MS);

    function finish(error) {
      clearTimeout(timer);
      process.removeListener('disconnect', onDisconnect);
      if (error === null) resolve();
      else reject(error);
    }

    function onDisconnect() {
      finish(null);
    }

    process.once('disconnect', onDisconnect);
  });
}

function sendWorkerMessage(message) {
  if (typeof process.send !== 'function') {
    throw new Error('WORKER_IPC_UNAVAILABLE');
  }
  process.send(message, () => {
    // Delivery is confirmed by the parent's exact message observation. A
    // concurrent IPC disconnect must not shorten the descendant's lifetime.
  });
}

async function writeWorkerEvidence(evidencePath, evidence) {
  if (typeof evidencePath !== 'string' || !path.isAbsolute(evidencePath)) {
    throw new Error('WORKER_EVIDENCE_PATH_INVALID');
  }
  await fsp.writeFile(evidencePath, canonicalJson(evidence), {
    encoding: 'utf8',
    flag: 'wx',
  });
}

async function runWorker(mode, evidencePath) {
  const evidenceMode =
    mode === 'tree-direct' || mode === 'inherited-pipe-direct';
  if (
    process.argv[2] !== WORKER_FLAG ||
    process.argv.length !== (evidenceMode ? 5 : 4)
  ) {
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

  if (mode === 'signal-hold') {
    await delay(TASK_OWNED_TREE_NATURAL_MS);
    return;
  }

  if (mode === 'overflow-stdout' || mode === 'overflow-stderr') {
    const buildModule = require('../scripts/build-windows-native.cjs');
    const stream = mode === 'overflow-stdout' ? process.stdout : process.stderr;
    const peer = mode === 'overflow-stdout' ? process.stderr : process.stdout;
    await writeBounded(peer, 'bounded-peer-stream\n');
    await writeBounded(
      stream,
      Buffer.alloc(buildModule.__test.MAX_PROCESS_OUTPUT_BYTES + 1, 0x78),
    );
    await delay(TASK_OWNED_TREE_NATURAL_MS);
    return;
  }

  if (mode === 'tree-descendant') {
    await delay(TASK_OWNED_TREE_NATURAL_MS);
    return;
  }

  if (mode === 'tree-direct') {
    const descendant = spawn(
      process.execPath,
      [__filename, WORKER_FLAG, 'tree-descendant'],
      {
        detached: false,
        shell: false,
        stdio: ['ignore', 'ignore', 'ignore'],
        windowsHide: true,
      },
    );
    await waitForSpawn(descendant);
    await writeWorkerEvidence(evidencePath, {
      kind: 'task-owned-tree',
      directPid: process.pid,
      descendantPid: descendant.pid,
      naturalLifetimeMs: TASK_OWNED_TREE_NATURAL_MS,
    });
    await delay(TASK_OWNED_TREE_NATURAL_MS);
    return;
  }

  if (mode === 'inherited-pipe-descendant') {
    process.stdout.once('error', () => {});
    await writeBounded(process.stdout, 'pipe-held-before-disconnect\n');
    const disconnected = waitForParentDisconnect();
    sendWorkerMessage({ status: 'pipe-held' });
    await disconnected;
    await delay(INHERITED_DESCENDANT_NATURAL_MS);
    return;
  }

  if (mode === 'inherited-pipe-direct') {
    // IPC proves the descendant reached the retained stdout handle. IPC is
    // closed before the direct worker exits so only stdout can delay close.
    const descendant = spawn(
      process.execPath,
      [__filename, WORKER_FLAG, 'inherited-pipe-descendant'],
      {
        detached: true,
        shell: false,
        stdio: ['ignore', process.stdout, 'ignore', 'ipc'],
        windowsHide: true,
      },
    );
    await waitForSpawn(descendant);
    await waitForPipeHeldHandshake(descendant);
    if (!descendant.connected) throw new Error('WORKER_IPC_DISCONNECTED_EARLY');
    descendant.disconnect();
    await writeWorkerEvidence(evidencePath, {
      kind: 'inherited-pipe',
      directPid: process.pid,
      descendantPid: descendant.pid,
      naturalLifetimeMs: INHERITED_DESCENDANT_NATURAL_MS,
    });
    descendant.unref();
    process.exit(0);
  }

  throw new Error('WORKER_MODE_INVALID');
}

if (process.argv[2] === WORKER_FLAG) {
  runWorker(process.argv[3], process.argv[4]).catch(() => {
    process.exitCode = 97;
  });
} else {
  const { performance } = require('node:perf_hooks');
  const { after, test } = require('node:test');
  const buildModule = require('../scripts/build-windows-native.cjs');
  const buildTest = buildModule.__test;
  const temporaryRoots = new Set();
  const taskOwnedPids = new Set();

  function workerArguments(mode, evidencePath) {
    const arguments_ = [__filename, WORKER_FLAG, mode];
    if (evidencePath !== undefined) arguments_.push(evidencePath);
    return arguments_;
  }

  async function captureError(promise) {
    try {
      await promise;
    } catch (error) {
      return error;
    }
    assert.fail('Expected the subprocess operation to fail.');
  }

  function assertNoRawProcessData(error, forbiddenValues = []) {
    for (const key of [
      'stdout',
      'stderr',
      'command',
      'file',
      'arguments',
      'args',
      'env',
      'environment',
      'path',
      'pid',
      'errno',
      'syscall',
      'spawnargs',
      'spawnfile',
    ]) {
      assert.equal(Object.hasOwn(error, key), false, `unexpected ${key}`);
    }
    const serialized = JSON.stringify(error);
    assert.equal(
      serialized.includes('MOXLEY_NATIVE_BUILD_SUBPROCESS_FAILED'),
      false,
    );
    for (const value of forbiddenValues) {
      assert.equal(serialized.includes(String(value)), false);
    }
  }

  function assertBuildError(
    error,
    { code, message, reason, terminationConfirmed, causeReason },
    forbiddenValues = [],
  ) {
    assert.equal(error.name, 'NativeBuildError');
    assert.equal(Object.hasOwn(error, 'code'), true);
    assert.equal(Object.hasOwn(error, 'reason'), true);
    assert.equal(Object.hasOwn(error, 'terminationConfirmed'), true);
    assert.equal(error.code, code);
    assert.equal(error.message, message);
    assert.equal(error.reason, reason);
    assert.equal(error.terminationConfirmed, terminationConfirmed);
    if (causeReason === undefined) {
      assert.equal(Object.hasOwn(error, 'cause'), false);
    } else {
      assert.equal(Object.hasOwn(error, 'cause'), true);
      assert.equal(Object.isFrozen(error.cause), true);
      assert.deepEqual(Reflect.ownKeys(error.cause), ['reason']);
      assert.deepEqual(error.cause, { reason: causeReason });
    }
    assertNoRawProcessData(error, forbiddenValues);
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

  async function withWorkerEvidence(action) {
    return withAuthenticatedTemporaryDirectory(async (root) => {
      const evidencePath = path.join(root, 'worker-evidence.json');
      try {
        return await action(evidencePath, root);
      } finally {
        try {
          const evidenceStat = await fsp.lstat(evidencePath);
          assert.equal(evidenceStat.isFile(), true);
          assert.equal(evidenceStat.isSymbolicLink(), false);
          await fsp.unlink(evidencePath);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
    });
  }

  async function readWorkerEvidence(root, evidencePath, expectedKind) {
    const stat = await fsp.lstat(evidencePath);
    assert.equal(stat.isFile(), true);
    assert.equal(stat.isSymbolicLink(), false);
    assert.ok(stat.size > 0 && stat.size <= 1_024);
    const canonicalRoot = await fsp.realpath(root);
    const canonicalEvidence = await fsp.realpath(evidencePath);
    const relative = path.relative(canonicalRoot, canonicalEvidence);
    assert.notEqual(relative, '');
    assert.equal(path.isAbsolute(relative), false);
    assert.equal(relative === '..' || relative.startsWith(`..${path.sep}`), false);
    const text = await fsp.readFile(canonicalEvidence, 'utf8');
    const evidence = JSON.parse(text);
    assert.equal(canonicalJson(evidence), text);
    assert.deepEqual(Reflect.ownKeys(evidence), [
      'kind',
      'directPid',
      'descendantPid',
      'naturalLifetimeMs',
    ]);
    assert.equal(evidence.kind, expectedKind);
    for (const pid of [evidence.directPid, evidence.descendantPid]) {
      assert.equal(Number.isSafeInteger(pid), true);
      assert.ok(pid > 0);
      assert.notEqual(pid, process.pid);
      assert.notEqual(pid, process.ppid);
      taskOwnedPids.add(pid);
    }
    assert.notEqual(evidence.directPid, evidence.descendantPid);
    assert.equal(Number.isSafeInteger(evidence.naturalLifetimeMs), true);
    assert.ok(evidence.naturalLifetimeMs > 0);
    return evidence;
  }

  function taskOwnedProcessExists(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if (error.code === 'ESRCH') return false;
      if (error.code === 'EPERM') return true;
      throw error;
    }
  }

  function assertTaskOwnedProcessAbsent(pid) {
    assert.equal(taskOwnedProcessExists(pid), false, `process ${pid} remains`);
    taskOwnedPids.delete(pid);
  }

  async function waitForTaskOwnedProcessAbsent(pid, timeoutMs) {
    const started = performance.now();
    while (taskOwnedProcessExists(pid)) {
      if (performance.now() - started >= timeoutMs) {
        assert.fail(`process ${pid} exceeded its independent absence bound`);
      }
      await delay(25);
    }
    taskOwnedPids.delete(pid);
  }

  function observeTerminationAttempt(attempts) {
    return (event) => attempts.push(event);
  }

  function assertExactTerminationAttempt(event) {
    assert.equal(Object.isFrozen(event), true);
    assert.deepEqual(Reflect.ownKeys(event), [
      'authenticatedExecutable',
      'canonicalPid',
      'tree',
      'force',
    ]);
    assert.deepEqual(event, {
      authenticatedExecutable: true,
      canonicalPid: true,
      tree: true,
      force: true,
    });
  }

  after(() => {
    assert.equal(temporaryRoots.size, 0);
    assert.equal(taskOwnedPids.size, 0);
  });

  test(
    'production subprocess supervision preserves ordinary zero-exit evidence',
    { timeout: TEST_CASE_TIMEOUT_MS },
    async () => {
      assert.equal(buildTest.PROCESS_TIMEOUT_MS, 30_000);
      assert.equal(buildTest.AUTHENTICATION_TIMEOUT_MS, 90_000);
      assert.equal(buildTest.PROBE_TIMEOUT_MS, 10_000);
      assert.equal(buildTest.EXIT_CLOSE_GRACE_MS, 5_000);
      assert.equal(buildTest.TASKKILL_TIMEOUT_MS, 10_000);
      assert.equal(buildTest.POST_TERMINATION_GRACE_MS, 5_000);
      assert.equal(buildTest.MAX_PROCESS_OUTPUT_BYTES, 2 * 1024 * 1024);
      const attempts = [];
      const result = await buildTest.runProcess(
        process.execPath,
        workerArguments('ordinary'),
        { onTerminationAttempt: observeTerminationAttempt(attempts) },
      );
      assert.equal(result.code, 0);
      assert.equal(result.signal, null);
      assert.equal(
        result.stdout.toString('utf8'),
        canonicalJson({ status: 'ordinary', evidence: 'bounded' }),
      );
      assert.equal(result.stderr.toString('utf8'), 'bounded-stderr\n');
      assert.deepEqual(attempts, []);
    },
  );

  test(
    'production subprocess success requirement distinguishes nonzero exit',
    { timeout: TEST_CASE_TIMEOUT_MS },
    async () => {
      const cases = [
        {
          mode: 'nonzero',
          reason: 'SUBPROCESS_NONZERO_EXIT',
          options: {},
        },
        {
          mode: 'signal-hold',
          reason: 'SUBPROCESS_SIGNALLED_EXIT',
          options: { signalAfterSpawn: true },
        },
      ];
      for (const item of cases) {
        const attempts = [];
        const error = await captureError(
          buildTest.requireProcessSuccess(
            'Bounded subprocess exit',
            process.execPath,
            workerArguments(item.mode),
            {
              ...item.options,
              onTerminationAttempt: observeTerminationAttempt(attempts),
            },
          ),
        );
        assert.equal(error.terminationConfirmed, true);
        assertBuildError(error, {
          code: 'MOXLEY_NATIVE_BUILD_SUBPROCESS_EXIT_FAILED',
          message: 'Native build subprocess did not exit successfully.',
          reason: item.reason,
          terminationConfirmed: true,
        });
        assert.deepEqual(attempts, []);
      }
    },
  );

  test(
    'production subprocess success requirement distinguishes spawn failure',
    { timeout: TEST_CASE_TIMEOUT_MS },
    async () => {
      await withAuthenticatedTemporaryDirectory(async (root) => {
        const absentExecutable = path.join(
          root,
          'absent-native-subprocess.exe',
        );
        await assert.rejects(fsp.lstat(absentExecutable), { code: 'ENOENT' });
        const attempts = [];
        const error = await captureError(
          buildTest.requireProcessSuccess(
            'Bounded spawn failure',
            absentExecutable,
            [],
            { onTerminationAttempt: observeTerminationAttempt(attempts) },
          ),
        );
        assert.equal(error.terminationConfirmed, false);
        assertBuildError(
          error,
          {
            code: 'MOXLEY_NATIVE_BUILD_SUBPROCESS_SPAWN_FAILED',
            message: 'Native build subprocess could not be spawned.',
            reason: 'SUBPROCESS_SPAWN_ERROR',
            terminationConfirmed: false,
          },
          [absentExecutable],
        );
        assert.deepEqual(attempts, []);
        await assert.rejects(fsp.lstat(absentExecutable), { code: 'ENOENT' });
      });
    },
  );

  test(
    'production subprocess timeout confirms bounded task-owned tree termination',
    { timeout: TEST_CASE_TIMEOUT_MS },
    async (context) => {
      await withWorkerEvidence(async (evidencePath, root) => {
        const attempts = [];
        const started = performance.now();
        const error = await captureError(
          buildTest.runProcess(
            process.execPath,
            workerArguments('tree-direct', evidencePath),
            {
              timeoutMs: TEST_EXECUTION_TIMEOUT_MS,
              onTerminationAttempt: observeTerminationAttempt(attempts),
            },
          ),
        );
        const settlementElapsedMs = performance.now() - started;
        const evidence = await readWorkerEvidence(
          root,
          evidencePath,
          'task-owned-tree',
        );
        assert.equal(attempts.length, 1);
        assertExactTerminationAttempt(attempts[0]);
        assert.equal(error.terminationConfirmed, true);
        assertBuildError(
          error,
          {
            code: 'MOXLEY_NATIVE_BUILD_SUBPROCESS_TIMED_OUT',
            message: 'Native build subprocess exceeded its execution bound.',
            reason: 'SUBPROCESS_TIMEOUT',
            terminationConfirmed: true,
          },
          [evidencePath, evidence.directPid, evidence.descendantPid],
        );
        assert.ok(
          settlementElapsedMs >= TEST_EXECUTION_TIMEOUT_MS - 25,
        );
        assert.ok(
          evidence.naturalLifetimeMs > TEST_EXECUTION_TIMEOUT_MS * 10,
        );
        assert.ok(settlementElapsedMs < evidence.naturalLifetimeMs);
        assertTaskOwnedProcessAbsent(evidence.directPid);
        assertTaskOwnedProcessAbsent(evidence.descendantPid);
        context.diagnostic(
          canonicalJson({
            executionTimeoutMs: TEST_EXECUTION_TIMEOUT_MS,
            naturalLifetimeMs: evidence.naturalLifetimeMs,
            settlementElapsedMs:
              Math.round(settlementElapsedMs * 1000) / 1000,
            exactTreeAttemptConfirmed: true,
            directAbsent: true,
            descendantAbsent: true,
          }).trimEnd(),
        );
      });
    },
  );

  test(
    'production subprocess output overflow distinguishes stdout and stderr',
    { timeout: TEST_CASE_TIMEOUT_MS },
    async () => {
      const cases = [
        { mode: 'overflow-stdout', reason: 'SUBPROCESS_STDOUT_LIMIT' },
        { mode: 'overflow-stderr', reason: 'SUBPROCESS_STDERR_LIMIT' },
      ];
      for (const item of cases) {
        const attempts = [];
        const error = await captureError(
          buildTest.runProcess(
            process.execPath,
            workerArguments(item.mode),
            { onTerminationAttempt: observeTerminationAttempt(attempts) },
          ),
        );
        assert.equal(attempts.length, 1);
        assertExactTerminationAttempt(attempts[0]);
        assert.equal(error.terminationConfirmed, true);
        assertBuildError(error, {
          code: 'MOXLEY_NATIVE_BUILD_SUBPROCESS_OUTPUT_LIMIT',
          message: 'Native build subprocess exceeded its output bound.',
          reason: item.reason,
          terminationConfirmed: true,
        });
      }
    },
  );

  test(
    'production subprocess exit-without-close fails boundedly with termination unconfirmed evidence',
    { timeout: TEST_CASE_TIMEOUT_MS },
    async (context) => {
      await withWorkerEvidence(async (evidencePath, root) => {
        const attempts = [];
        const started = performance.now();
        const error = await captureError(
          buildTest.runProcess(
            process.execPath,
            workerArguments('inherited-pipe-direct', evidencePath),
            {
              exitCloseGraceMs: TEST_EXIT_CLOSE_GRACE_MS,
              postTerminationGraceMs: TEST_POST_TERMINATION_GRACE_MS,
              onTerminationAttempt: observeTerminationAttempt(attempts),
            },
          ),
        );
        const settlementElapsedMs = performance.now() - started;
        const evidence = await readWorkerEvidence(
          root,
          evidencePath,
          'inherited-pipe',
        );
        assert.deepEqual(attempts, []);
        assert.equal(error.terminationConfirmed, false);
        assertBuildError(
          error,
          {
            code:
              'MOXLEY_NATIVE_BUILD_SUBPROCESS_TERMINATION_UNCONFIRMED',
            message:
              'Native build subprocess termination could not be confirmed.',
            reason: 'SUBPROCESS_TERMINATION_NOT_CONFIRMED',
            terminationConfirmed: false,
            causeReason: 'SUBPROCESS_EXIT_WITHOUT_CLOSE',
          },
          [evidencePath, evidence.directPid, evidence.descendantPid],
        );
        assert.ok(
          settlementElapsedMs >=
            TEST_EXIT_CLOSE_GRACE_MS + TEST_POST_TERMINATION_GRACE_MS - 25,
        );
        assert.ok(
          evidence.naturalLifetimeMs >
            (TEST_EXIT_CLOSE_GRACE_MS + TEST_POST_TERMINATION_GRACE_MS) * 5,
        );
        assertTaskOwnedProcessAbsent(evidence.directPid);
        assert.equal(taskOwnedProcessExists(evidence.descendantPid), true);
        await waitForTaskOwnedProcessAbsent(
          evidence.descendantPid,
          TASK_OWNED_ABSENCE_BOUND_MS,
        );
        context.diagnostic(
          canonicalJson({
            exitCloseGraceMs: TEST_EXIT_CLOSE_GRACE_MS,
            postTerminationGraceMs: TEST_POST_TERMINATION_GRACE_MS,
            naturalLifetimeMs: evidence.naturalLifetimeMs,
            settlementElapsedMs:
              Math.round(settlementElapsedMs * 1000) / 1000,
            taskkillDispatched: false,
            descendantNaturallyAbsent: true,
          }).trimEnd(),
        );
      });
    },
  );
}
