'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const Moxley = require('..');

const WORKER_PATH = path.join(
  __dirname,
  'fixtures',
  'detached-load-failure-worker.cjs',
);
const SYNCHRONIZATION_TIMEOUT_MS = 5_000;
const CHILD_PROCESS_TIMEOUT_MS = 10_000;

function createDeferred() {
  let resolvePromise;
  let rejectPromise;
  let settled = false;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    get settled() {
      return settled;
    },
    resolve(value) {
      if (!settled) {
        settled = true;
        resolvePromise(value);
      }
    },
    reject(error) {
      if (!settled) {
        settled = true;
        rejectPromise(error);
      }
    },
  };
}

function withTimeout(promise, label, timeoutMs = SYNCHRONIZATION_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${label} timed out`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

async function createTestDirectory(t) {
  const testDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'moxley-load-readiness-'),
  );

  t.after(async () => {
    await rm(testDirectory, { recursive: true, force: true, maxRetries: 3 });
  });

  return testDirectory;
}

function runDetachedFailureWorker(testDirectory) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WORKER_PATH, testDirectory], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let spawnError;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, CHILD_PROCESS_TIMEOUT_MS);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      spawnError = error;
    });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timeout);

      if (timedOut) {
        reject(new Error('detached-failure worker timed out'));
        return;
      }

      if (spawnError) {
        reject(
          new Error(
            `detached-failure worker failed to start: ${spawnError.name}`,
          ),
        );
        return;
      }

      if (stderr.trim() !== '') {
        reject(new Error('detached-failure worker wrote unexpected stderr'));
        return;
      }

      let payload;
      try {
        payload = JSON.parse(stdout.trim());
      } catch {
        reject(new Error('detached-failure worker emitted invalid JSON'));
        return;
      }

      if (exitCode !== 0 || signal !== null) {
        reject(
          new Error(
            `detached-failure worker exited unexpectedly: ${payload.status}`,
          ),
        );
        return;
      }

      resolve(payload);
    });
  });
}

test(
  'awaiting _loadFromDir establishes complete recursive readiness',
  { timeout: 15_000 },
  async (t) => {
    const testDirectory = await createTestDirectory(t);
    const databaseDirectory = path.join(testDirectory, 'database');
    const databasePath = `${databaseDirectory}${path.sep}`;
    const seeded = new Moxley(databasePath);
    seeded.db._create('descendant');

    const reopened = new Moxley(databasePath);
    const root = reopened.db;
    const rootLocation = path.resolve(root._loc);
    const descendantRequested = createDeferred();
    const descendantGate = createDeferred();
    const descendantCompleted = createDeferred();
    const databasePrototype = Object.getPrototypeOf(root);
    const originalPrototypeLoadFromDir = databasePrototype._loadFromDir;
    const originalRootLoadState = root._loadState.bind(root);
    const loadRoot = root._loadFromDir.bind(root);

    root._loadState = async (location) => {
      if (path.resolve(location) !== rootLocation) {
        descendantRequested.resolve();
        await descendantGate.promise;
      }

      return originalRootLoadState(location);
    };

    databasePrototype._loadFromDir = async function (...args) {
      const result = await originalPrototypeLoadFromDir.apply(this, args);
      if (this !== root) {
        descendantCompleted.resolve();
      }
      return result;
    };

    let outerStatus = 'pending';
    const outerSettlement = loadRoot().then(
      (value) => {
        outerStatus = 'resolved';
        return { status: outerStatus, returnedSameRoot: value === root };
      },
      (error) => {
        outerStatus = 'rejected';
        return { status: outerStatus, errorName: error.name };
      },
    );

    try {
      await withTimeout(
        descendantRequested.promise,
        'descendant load request',
      );
      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(descendantGate.settled, false);
      assert.equal(outerStatus, 'pending');
      assert.equal(descendantCompleted.settled, false);
      assert.equal(root._children.length, 0);
      assert.equal(root.descendant, null);
    } finally {
      descendantGate.resolve();
      try {
        await withTimeout(
          descendantCompleted.promise,
          'descendant load completion',
        );
      } finally {
        databasePrototype._loadFromDir = originalPrototypeLoadFromDir;
        delete root._loadState;
      }
    }

    assert.equal(descendantGate.settled, true);
    const outerResult = await withTimeout(outerSettlement, 'outer load');
    assert.deepEqual(outerResult, {
      status: 'resolved',
      returnedSameRoot: true,
    });
    assert.equal(root._children.length, 1);
    assert.equal(root.descendant === root._children[0], true);
  },
);

test(
  'descendant load failure rejects the returned _loadFromDir promise',
  { timeout: 15_000 },
  async (t) => {
    const testDirectory = await createTestDirectory(t);
    const result = await runDetachedFailureWorker(testDirectory);

    assert.deepEqual(result, {
      status: 'propagated',
      outerStatus: 'rejected',
      outerErrorName: 'SyntaxError',
      detachedRejections: [],
    });
  },
);
