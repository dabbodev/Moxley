'use strict';

const assert = require('node:assert/strict');
const { mkdtemp, readdir, readFile, rm, stat } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

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

async function createDuplicateCreateScenario(t) {
  const testDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'moxley-duplicate-create-'),
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
    root: database.db,
  };
}

test(
  'duplicate _create returns a distinct appended child while named lookup stays on the first',
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    const { root } = await createDuplicateCreateScenario(t);

    const first = root._create('descendant');
    const second = root._create('descendant');

    assert.equal(typeof first, 'object');
    assert.notEqual(first, null);
    assert.equal(typeof second, 'object');
    assert.notEqual(second, null);
    assert.notStrictEqual(second, first);
    assert.equal(root._children.length, 2);
    assert.strictEqual(root._children[0], first);
    assert.strictEqual(root._children[1], second);
    assert.equal(first._id, '0/0');
    assert.equal(second._id, '0/1');
    assert.equal(first._name, 'descendant');
    assert.equal(second._name, 'descendant');
    assert.strictEqual(root.descendant, first);
    assert.notStrictEqual(root.descendant, second);
  },
);

test(
  'duplicate _create creates a second directory without changing the named link',
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    const { databaseDirectory, root } =
      await createDuplicateCreateScenario(t);
    const firstDirectory = path.join(databaseDirectory, '0');
    const secondDirectory = path.join(databaseDirectory, '1');
    const namedLinkPath = path.join(databaseDirectory, 'descendant.ml');
    const rootStatePath = path.join(databaseDirectory, '_state.ms');

    root._create('descendant');
    const firstEntries = (await readdir(databaseDirectory)).sort();
    const firstNamedLinkBytes = await readFile(namedLinkPath);
    const firstRootStateBytes = await readFile(rootStatePath);

    assert.deepEqual(firstEntries, ['0', '_state.ms', 'descendant.ml']);
    assert.equal(path.basename(namedLinkPath), 'descendant.ml');
    assert.equal(firstNamedLinkBytes.toString('utf8'), '0/0');

    root._create('descendant');
    const secondEntries = (await readdir(databaseDirectory)).sort();
    const firstEntrySet = new Set(firstEntries);
    const secondEntrySet = new Set(secondEntries);
    const removedEntries = firstEntries.filter(
      (entry) => !secondEntrySet.has(entry),
    );
    const addedEntries = secondEntries.filter(
      (entry) => !firstEntrySet.has(entry),
    );
    const secondNamedLinkBytes = await readFile(namedLinkPath);
    const secondRootStateBytes = await readFile(rootStatePath);

    assert.deepEqual(removedEntries, []);
    assert.deepEqual(addedEntries, ['1']);
    assert.equal((await stat(firstDirectory)).isDirectory(), true);
    assert.equal((await stat(secondDirectory)).isDirectory(), true);
    assert.equal(
      (await stat(path.join(secondDirectory, '_state.ms'))).isFile(),
      true,
    );
    assert.deepEqual(secondNamedLinkBytes, firstNamedLinkBytes);
    assert.equal(secondNamedLinkBytes.toString('utf8'), '0/0');
    assert.deepEqual(secondRootStateBytes, firstRootStateBytes);
  },
);
