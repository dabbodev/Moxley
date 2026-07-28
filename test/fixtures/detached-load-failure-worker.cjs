'use strict';

const { writeFileSync } = require('node:fs');
const path = require('node:path');

const Moxley = require('../..');

const DETACHED_REJECTION_TIMEOUT_MS = 5_000;

function errorName(error) {
  if (error && typeof error.name === 'string') {
    return error.name;
  }
  return typeof error;
}

function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function waitForDetachedRejection(promise) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve(false);
    }, DETACHED_REJECTION_TIMEOUT_MS);

    promise.then(() => {
      clearTimeout(timeout);
      resolve(true);
    });
  });
}

async function main() {
  const testDirectory = process.argv[2];
  if (!testDirectory || !path.isAbsolute(testDirectory)) {
    throw new TypeError('worker requires an absolute test directory');
  }

  const databaseDirectory = path.join(testDirectory, 'database');
  const databasePath = `${databaseDirectory}${path.sep}`;
  const seeded = new Moxley(databasePath);
  seeded.db._create('descendant');
  writeFileSync(
    path.join(databaseDirectory, '0', '_state.ms'),
    'malformed descendant state',
  );

  const reopened = new Moxley(databasePath);
  const root = reopened.db;
  let outerStatus = 'pending';
  let outerResolvedBeforeDetachedRejection = false;
  const detachedRejections = [];
  let resolveDetachedRejection;
  const detachedRejection = new Promise((resolve) => {
    resolveDetachedRejection = resolve;
  });
  const onUnhandledRejection = (error) => {
    outerResolvedBeforeDetachedRejection = outerStatus === 'resolved';
    detachedRejections.push({ name: errorName(error) });
    resolveDetachedRejection();
  };

  process.on('unhandledRejection', onUnhandledRejection);

  try {
    const outerResult = await root._loadFromDir().then(
      (value) => {
        outerStatus = 'resolved';
        return {
          status: outerStatus,
          returnedSameRoot: value === root,
        };
      },
      (error) => {
        outerStatus = 'rejected';
        return {
          status: outerStatus,
          errorName: errorName(error),
        };
      },
    );

    if (outerResult.status !== 'resolved') {
      emit({
        status: 'outer-rejected',
        outerStatus,
        errorName: outerResult.errorName,
      });
      process.exitCode = 2;
      return;
    }

    const observed = await waitForDetachedRejection(detachedRejection);
    if (!observed) {
      emit({
        status: 'timeout',
        outerStatus,
        returnedSameRoot: outerResult.returnedSameRoot,
      });
      process.exitCode = 3;
      return;
    }

    await new Promise((resolve) => setImmediate(resolve));
    emit({
      status: 'characterized',
      outerStatus,
      returnedSameRoot: outerResult.returnedSameRoot,
      outerResolvedBeforeDetachedRejection,
      detachedRejections,
    });
  } finally {
    process.removeListener('unhandledRejection', onUnhandledRejection);
  }
}

main().catch((error) => {
  emit({
    status: 'unexpected-failure',
    errorName: errorName(error),
  });
  process.exitCode = 1;
});
