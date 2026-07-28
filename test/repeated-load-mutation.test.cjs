'use strict';

const assert = require('node:assert/strict');
const { mkdtemp, readdir, rm, stat } = require('node:fs/promises');
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

async function createRepeatedLoadScenario(t) {
  const testDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'moxley-repeated-load-'),
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
  const seeded = new Moxley(databasePath);
  seeded.db._create('descendant');

  const reopened = new Moxley(databasePath);
  return {
    databaseDirectory,
    root: reopened.db,
  };
}

test(
  'calling _loadFromDir twice preserves reconstructed child identity',
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    const { root } = await createRepeatedLoadScenario(t);

    const firstResult = await root._loadFromDir();
    const firstSnapshot = [...root._children];
    const firstChild = firstSnapshot[0];

    assert.strictEqual(firstResult, root);
    assert.equal(firstSnapshot.length, 1);
    assert.equal(firstChild._id, '0/0');

    const secondResult = await root._loadFromDir();
    const secondSnapshot = [...root._children];
    const childAfterSecondLoad = secondSnapshot[0];

    assert.strictEqual(secondResult, root);
    assert.equal(secondSnapshot.length, 1);
    assert.strictEqual(childAfterSecondLoad, firstChild);
    assert.equal(childAfterSecondLoad._id, '0/0');
    assert.equal(
      secondSnapshot.some((child) => child._id === '0/1'),
      false,
    );
  },
);

test(
  'repeated _loadFromDir preserves named lookup and directory entries',
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    const { databaseDirectory, root } =
      await createRepeatedLoadScenario(t);

    await root._loadFromDir();
    const firstChild = root._children[0];
    const firstNamedLookup = root.descendant;
    const firstEntries = (await readdir(databaseDirectory)).sort();
    const secondDirectory = path.join(databaseDirectory, '1');

    assert.strictEqual(firstNamedLookup, firstChild);
    await assert.rejects(
      stat(secondDirectory),
      (error) => error && error.code === 'ENOENT',
    );

    await root._loadFromDir();
    const secondEntries = (await readdir(databaseDirectory)).sort();

    assert.deepEqual(secondEntries, firstEntries);
    await assert.rejects(
      stat(secondDirectory),
      (error) => error && error.code === 'ENOENT',
    );
    assert.strictEqual(root.descendant, firstChild);
    assert.strictEqual(root._children[0], firstChild);
    assert.equal(root._children.length, 1);
  },
);
