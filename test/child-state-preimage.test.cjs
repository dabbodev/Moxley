'use strict';

const assert = require('node:assert/strict');
const { mkdtemp, readdir, readFile, rm, stat } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { parse } = require('flatted');

const Moxley = require('..');

const CLEANUP_TIMEOUT_MS = 5_000;
const TEST_TIMEOUT_MS = 15_000;

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

async function createChildStateScenario(t) {
  const testDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'moxley-child-state-preimage-'),
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

  return {
    databaseDirectory,
    databasePath,
    root: database.db,
  };
}

test(
  'named child state is written with provisional id and name',
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    const { databaseDirectory, root } =
      await createChildStateScenario(t);
    const childDirectory = path.join(databaseDirectory, '0');
    const childStatePath = path.join(childDirectory, '_state.ms');
    const namedLinkPath = path.join(databaseDirectory, 'descendant.ml');
    const rootStatePath = path.join(databaseDirectory, '_state.ms');

    const child = root._create('descendant');
    const entries = (await readdir(databaseDirectory)).sort();
    const provisionalPersistedChildState = parse(
      (await readFile(childStatePath)).toString('utf8'),
    );
    const rootState = parse(
      (await readFile(rootStatePath)).toString('utf8'),
    );
    const namedLinkBytes = await readFile(namedLinkPath);

    assert.equal(path.resolve(child._loc), path.resolve(childDirectory));
    assert.equal(child._id, '0/0');
    assert.equal(child._name, 'descendant');
    assert.deepEqual(child._keys, []);
    assert.deepEqual(child._bindings, []);

    assert.equal((await stat(childStatePath)).isFile(), true);
    assert.equal(provisionalPersistedChildState._loc, child._loc);
    assert.equal(
      path.resolve(provisionalPersistedChildState._loc),
      path.resolve(childDirectory),
    );
    assert.equal(provisionalPersistedChildState._id, '0');
    assert.equal(provisionalPersistedChildState._name, 'root');
    assert.deepEqual(provisionalPersistedChildState._keys, []);
    assert.deepEqual(provisionalPersistedChildState._bindings, []);

    assert.equal(root._children.length, 1);
    assert.strictEqual(root._children[0], child);
    assert.strictEqual(root.descendant, child);
    assert.equal(namedLinkBytes.toString('utf8'), '0/0');
    assert.deepEqual(entries, ['0', '_state.ms', 'descendant.ml']);
    assert.equal(rootState._id, '0');
    assert.equal(rootState._name, 'root');
    assert.deepEqual(rootState._keys, ['descendant']);
    assert.deepEqual(rootState._bindings, []);
  },
);

test(
  'reopen reconstructs the provisional child name and creates a root binding artifact',
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    const { databaseDirectory, databasePath, root } =
      await createChildStateScenario(t);
    const rootStatePath = path.join(databaseDirectory, '_state.ms');
    const namedLinkPath = path.join(databaseDirectory, 'descendant.ml');
    const rootLinkPath = path.join(databaseDirectory, 'root.ml');
    const secondDirectory = path.join(databaseDirectory, '1');

    root._create('descendant');
    const beforeEntries = (await readdir(databaseDirectory)).sort();
    const beforeRootStateBytes = await readFile(rootStatePath);

    const reopenedDatabase = new Moxley(databasePath);
    const reopenedRoot = reopenedDatabase.db;
    const loadResult = await reopenedRoot._loadFromDir();
    const reconstructedChild = reopenedRoot._children[0];
    const afterEntries = (await readdir(databaseDirectory)).sort();
    const beforeEntrySet = new Set(beforeEntries);
    const addedEntries = afterEntries.filter(
      (entry) => !beforeEntrySet.has(entry),
    );
    const afterRootStateBytes = await readFile(rootStatePath);
    const reparsedRootState = parse(
      afterRootStateBytes.toString('utf8'),
    );

    assert.strictEqual(loadResult, reopenedRoot);
    assert.equal(reopenedRoot._children.length, 1);
    assert.equal(reconstructedChild._id, '0/0');
    assert.equal(reconstructedChild._name, 'root');
    assert.notEqual(reconstructedChild._name, 'descendant');
    assert.deepEqual(reconstructedChild._keys, []);
    assert.deepEqual(reconstructedChild._bindings, []);
    assert.strictEqual(reopenedRoot.descendant, reconstructedChild);
    assert.deepEqual(reopenedRoot._keys, ['descendant', 'root']);

    assert.deepEqual(beforeEntries, [
      '0',
      '_state.ms',
      'descendant.ml',
    ]);
    assert.deepEqual(afterEntries, [
      '0',
      '_state.ms',
      'descendant.ml',
      'root.ml',
    ]);
    assert.deepEqual(addedEntries, ['root.ml']);
    assert.equal((await readFile(rootLinkPath, 'utf8')), '0/0');
    assert.equal((await readFile(namedLinkPath, 'utf8')), '0/0');
    await assert.rejects(
      stat(secondDirectory),
      (error) => error && error.code === 'ENOENT',
    );
    assert.deepEqual(afterRootStateBytes, beforeRootStateBytes);
    assert.deepEqual(reparsedRootState._keys, ['descendant']);
  },
);
