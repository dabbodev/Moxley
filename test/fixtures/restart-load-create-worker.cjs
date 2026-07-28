'use strict';

const path = require('node:path');

const Moxley = require('../..');

const SUPPORTED_OPERATIONS = new Set(['load-create', 'inspect']);

function errorName(error) {
  if (error && typeof error.name === 'string') {
    return error.name;
  }
  return typeof error;
}

function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function invalidInput(status) {
  emit({ status });
  process.exitCode = 2;
}

async function loadCreate(databasePath) {
  const database = new Moxley(databasePath);
  const root = database.db;
  const loadResult = await root._loadFromDir();
  const beforeChildren = [...root._children];
  const reconstructedChild = beforeChildren[0];
  const beforeNamedChild = root.descendant;
  const createdChild = root._create('descendant');
  const afterChildren = [...root._children];
  const afterNamedChild = root.descendant;

  emit({
    status: 'load-create-observed',
    loadReturnedSameRoot: loadResult === root,
    beforeChildCount: beforeChildren.length,
    beforeChildIds: beforeChildren.map((child) => child._id),
    beforeChildNames: beforeChildren.map((child) => child._name),
    beforeNamedChildIndex: beforeChildren.indexOf(beforeNamedChild),
    beforeNamedIsReconstructed: beforeNamedChild === reconstructedChild,
    createdReturnedObject:
      createdChild !== null && typeof createdChild === 'object',
    createdDistinctFromReconstructed: createdChild !== reconstructedChild,
    createdId: createdChild._id,
    createdName: createdChild._name,
    afterChildCount: afterChildren.length,
    afterChildIds: afterChildren.map((child) => child._id),
    afterChildNames: afterChildren.map((child) => child._name),
    afterFirstIsReconstructed: afterChildren[0] === reconstructedChild,
    afterSecondIsCreated: afterChildren[1] === createdChild,
    afterNamedChildIndex: afterChildren.indexOf(afterNamedChild),
    afterNamedIsReconstructed: afterNamedChild === reconstructedChild,
    afterNamedIsCreated: afterNamedChild === createdChild,
  });
}

async function inspect(databasePath) {
  const database = new Moxley(databasePath);
  const root = database.db;
  const loadResult = await root._loadFromDir();
  const children = [...root._children];
  const namedChild = root.descendant;

  emit({
    status: 'inspect-observed',
    loadReturnedSameRoot: loadResult === root,
    childCount: children.length,
    childIds: children.map((child) => child._id),
    childNames: children.map((child) => child._name),
    namedChildIndex: children.indexOf(namedChild),
    namedIsFirst: namedChild === children[0],
    namedIsSecond: namedChild === children[1],
  });
}

async function main() {
  if (process.argv.length !== 4) {
    invalidInput('invalid-arguments');
    return;
  }

  const operation = process.argv[2];
  const databaseDirectory = process.argv[3];

  if (!SUPPORTED_OPERATIONS.has(operation)) {
    invalidInput('unsupported-operation');
    return;
  }

  if (!path.isAbsolute(databaseDirectory)) {
    invalidInput('invalid-database-directory');
    return;
  }

  const databasePath = `${databaseDirectory}${path.sep}`;

  if (operation === 'load-create') {
    await loadCreate(databasePath);
    return;
  }

  await inspect(databasePath);
}

main().catch((error) => {
  emit({
    status: 'unexpected-failure',
    errorName: errorName(error),
  });
  process.exitCode = 1;
});
