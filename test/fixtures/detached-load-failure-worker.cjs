'use strict';

const { writeFileSync } = require('node:fs');
const path = require('node:path');

const Moxley = require('../..');

const OUTER_SETTLEMENT_TIMEOUT_MS = 5_000;

function errorName(error) {
  if (error && typeof error.name === 'string') {
    return error.name;
  }
  return typeof error;
}

function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function observeOuterSettlement(promise) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ status: 'timeout' });
    }, OUTER_SETTLEMENT_TIMEOUT_MS);

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve({ status: 'resolved', value });
      },
      (error) => {
        clearTimeout(timeout);
        resolve({ status: 'rejected', error });
      },
    );
  });
}

async function main() {
  const testDirectory = process.argv[2];
  if (!testDirectory || !path.isAbsolute(testDirectory)) {
    emit({ status: 'invalid-input' });
    process.exitCode = 2;
    return;
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
  const detachedRejections = [];
  const onUnhandledRejection = (error) => {
    detachedRejections.push({ name: errorName(error) });
  };

  process.on('unhandledRejection', onUnhandledRejection);

  try {
    const outerResult = await observeOuterSettlement(root._loadFromDir());
    outerStatus = outerResult.status;

    if (outerStatus === 'timeout') {
      emit({
        status: 'timeout',
        outerStatus,
        detachedRejections,
      });
      process.exitCode = 3;
      return;
    }

    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    if (detachedRejections.length > 0) {
      emit({
        status: 'detached-rejection',
        outerStatus,
        detachedRejections,
      });
      process.exitCode = 4;
      return;
    }

    if (outerStatus === 'resolved') {
      emit({
        status: 'unexpected-outer-resolution',
        outerStatus,
        returnedSameRoot: outerResult.value === root,
        detachedRejections,
      });
      process.exitCode = 5;
      return;
    }

    const outerErrorName = errorName(outerResult.error);
    if (outerErrorName !== 'SyntaxError') {
      emit({
        status: 'unexpected-outer-rejection',
        outerStatus,
        outerErrorName,
        detachedRejections,
      });
      process.exitCode = 6;
      return;
    }

    emit({
      status: 'propagated',
      outerStatus,
      outerErrorName,
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
