'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtemp, readdir, readFile, rm, stat } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { parse } = require('flatted');

const Moxley = require('..');

const WORKER_PATH = path.join(
  __dirname,
  'fixtures',
  'restart-load-create-worker.cjs',
);
const CHILD_PROCESS_TIMEOUT_MS = 10_000;
const CLEANUP_TIMEOUT_MS = 5_000;
const TEST_TIMEOUT_MS = 35_000;

const EXPECTED_LOAD_CREATE = {
  status: 'load-create-observed',
  loadReturnedSameRoot: true,
  beforeChildCount: 1,
  beforeChildIds: ['0/0'],
  beforeChildNames: ['descendant'],
  beforeNamedChildIndex: 0,
  beforeNamedIsReconstructed: true,
  createdReturnedObject: true,
  createdDistinctFromReconstructed: true,
  createdId: '0/1',
  createdName: 'descendant',
  afterChildCount: 2,
  afterChildIds: ['0/0', '0/1'],
  afterChildNames: ['descendant', 'descendant'],
  afterFirstIsReconstructed: true,
  afterSecondIsCreated: true,
  afterNamedChildIndex: 0,
  afterNamedIsReconstructed: true,
  afterNamedIsCreated: false,
};

const EXPECTED_INSPECT = {
  status: 'inspect-observed',
  loadReturnedSameRoot: true,
  childCount: 2,
  childIds: ['0/0', '0/1'],
  childNames: ['descendant', 'descendant'],
  namedChildIndex: 0,
  namedIsFirst: true,
  namedIsSecond: false,
};

function withTimeout(promise, label, timeoutMs) {
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

async function createRestartScenario(t) {
  const testDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'moxley-restart-load-create-'),
  );

  t.after(async () => {
    await withTimeout(
      rm(testDirectory, { recursive: true, force: true, maxRetries: 3 }),
      'temporary directory cleanup',
      CLEANUP_TIMEOUT_MS,
    );
  });

  const databaseDirectory = path.join(testDirectory, 'database');
  const databasePath = `${databaseDirectory}${path.sep}`;
  const database = new Moxley(databasePath);
  const root = database.db;
  const seededChild = root._create('descendant');

  return {
    databaseDirectory,
    root,
    seededChild,
  };
}

function runWorker(operation, databaseDirectory) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [WORKER_PATH, operation, databaseDirectory],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    let stdout = '';
    let stderr = '';
    let spawnError;
    let settled = false;

    function fail(message) {
      if (!settled) {
        settled = true;
        reject(new Error(message));
      }
    }

    const timeout = setTimeout(() => {
      child.kill();
      fail(`${operation} worker timed out`);
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

      if (settled) {
        return;
      }

      if (spawnError) {
        fail(`${operation} worker failed to start: ${spawnError.name}`);
        return;
      }

      if (signal !== null) {
        fail(`${operation} worker exited by signal`);
        return;
      }

      if (stderr !== '') {
        fail(`${operation} worker wrote unexpected stderr`);
        return;
      }

      if (
        !stdout.endsWith('\n') ||
        stdout.slice(0, -1).includes('\n') ||
        stdout.slice(0, -1).endsWith('\r')
      ) {
        fail(`${operation} worker emitted invalid framing`);
        return;
      }

      let payload;
      try {
        payload = JSON.parse(stdout.slice(0, -1));
      } catch {
        fail(`${operation} worker emitted invalid JSON`);
        return;
      }

      if (exitCode !== 0) {
        const status =
          payload && typeof payload.status === 'string'
            ? payload.status
            : 'unknown';
        fail(`${operation} worker exited unexpectedly: ${status}`);
        return;
      }

      const expectedStatus =
        operation === 'load-create'
          ? 'load-create-observed'
          : 'inspect-observed';
      if (!payload || payload.status !== expectedStatus) {
        fail(`${operation} worker emitted unexpected status`);
        return;
      }

      settled = true;
      resolve(payload);
    });
  });
}

async function directoryEntries(databaseDirectory, entries) {
  const directories = [];

  for (const entry of entries) {
    if ((await stat(path.join(databaseDirectory, entry))).isDirectory()) {
      directories.push(entry);
    }
  }

  return directories;
}

test(
  'fresh-process load then duplicate _create appends a child while named lookup stays reconstructed first',
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    const { databaseDirectory, root, seededChild } =
      await createRestartScenario(t);
    const namedLinkPath = path.join(databaseDirectory, 'descendant.ml');
    const rootStatePath = path.join(databaseDirectory, '_state.ms');
    const initialEntries = (await readdir(databaseDirectory)).sort();
    const initialDirectories = await directoryEntries(
      databaseDirectory,
      initialEntries,
    );
    const initialNamedLinkBytes = await readFile(namedLinkPath);
    const initialRootStateBytes = await readFile(rootStatePath);
    const initialRootState = parse(initialRootStateBytes.toString('utf8'));

    assert.equal(seededChild._id, '0/0');
    assert.strictEqual(root._children[0], seededChild);
    assert.equal(root._children.length, 1);
    assert.deepEqual(initialEntries, [
      '0',
      '_state.ms',
      'descendant.ml',
    ]);
    assert.deepEqual(initialDirectories, ['0']);
    assert.equal(initialNamedLinkBytes.toString('utf8'), '0/0');
    assert.deepEqual(initialRootState._keys, ['descendant']);

    const loadCreateResult = await runWorker(
      'load-create',
      databaseDirectory,
    );
    assert.deepEqual(loadCreateResult, EXPECTED_LOAD_CREATE);

    const finalEntries = (await readdir(databaseDirectory)).sort();
    const finalDirectories = await directoryEntries(
      databaseDirectory,
      finalEntries,
    );
    const addedDirectories = finalDirectories.filter(
      (entry) => !initialDirectories.includes(entry),
    );
    const finalNamedLinkBytes = await readFile(namedLinkPath);
    const finalRootStateBytes = await readFile(rootStatePath);
    const finalRootState = parse(finalRootStateBytes.toString('utf8'));

    assert.deepEqual(finalEntries, [
      '0',
      '1',
      '_state.ms',
      'descendant.ml',
    ]);
    assert.deepEqual(addedDirectories, ['1']);
    assert.equal(
      (await stat(path.join(databaseDirectory, '0'))).isDirectory(),
      true,
    );
    assert.equal(
      (await stat(path.join(databaseDirectory, '1'))).isDirectory(),
      true,
    );
    assert.equal(
      (
        await stat(
          path.join(databaseDirectory, '1', '_state.ms'),
        )
      ).isFile(),
      true,
    );
    assert.deepEqual(finalNamedLinkBytes, initialNamedLinkBytes);
    assert.equal(finalNamedLinkBytes.toString('utf8'), '0/0');
    await assert.rejects(
      stat(path.join(databaseDirectory, 'root.ml')),
      (error) => error && error.code === 'ENOENT',
    );
    assert.deepEqual(finalRootStateBytes, initialRootStateBytes);
    assert.deepEqual(finalRootState._keys, ['descendant']);
  },
);

test(
  'a second fresh-process load reconstructs both children while the original named link remains',
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    const { databaseDirectory } = await createRestartScenario(t);
    const namedLinkPath = path.join(databaseDirectory, 'descendant.ml');
    const rootStatePath = path.join(databaseDirectory, '_state.ms');

    const loadCreateResult = await runWorker(
      'load-create',
      databaseDirectory,
    );
    assert.deepEqual(loadCreateResult, EXPECTED_LOAD_CREATE);

    const beforeInspectEntries = (
      await readdir(databaseDirectory)
    ).sort();
    const beforeInspectNamedLinkBytes = await readFile(namedLinkPath);
    const beforeInspectRootStateBytes = await readFile(rootStatePath);

    const inspectResult = await runWorker('inspect', databaseDirectory);
    assert.deepEqual(inspectResult, EXPECTED_INSPECT);

    const afterInspectEntries = (
      await readdir(databaseDirectory)
    ).sort();
    const afterInspectNamedLinkBytes = await readFile(namedLinkPath);
    const afterInspectRootStateBytes = await readFile(rootStatePath);

    assert.deepEqual(afterInspectEntries, beforeInspectEntries);
    assert.deepEqual(beforeInspectEntries, [
      '0',
      '1',
      '_state.ms',
      'descendant.ml',
    ]);
    await assert.rejects(
      stat(path.join(databaseDirectory, '2')),
      (error) => error && error.code === 'ENOENT',
    );
    assert.deepEqual(
      afterInspectNamedLinkBytes,
      beforeInspectNamedLinkBytes,
    );
    assert.equal(afterInspectNamedLinkBytes.toString('utf8'), '0/0');
    assert.deepEqual(
      afterInspectRootStateBytes,
      beforeInspectRootStateBytes,
    );
  },
);
