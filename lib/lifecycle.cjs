'use strict';

// One private in-process state per database, shared by raw objects and proxies.
// It is never part of node/collection metadata or user values.
const owners = new WeakMap();

function attach(object, owner) {
  owners.set(object, owner ? owners.get(owner) : {
    closed: false, active: 0, failed: false, failure: undefined,
  });
}

function assertOpen(object) {
  if (owners.get(object).closed) {
    throw Object.assign(new Error('Moxley database is closed'), { code: 'MOXLEY_CLOSED' });
  }
}

function run(object, operation, asynchronous = false) {
  assertOpen(object);
  const state = owners.get(object);
  state.active++;
  if (!asynchronous) {
    try { return operation(); } finally { state.active--; }
  }
  let result;
  try { result = operation(); } catch (error) {
    state.active--;
    if (!state.failed) { state.failed = true; state.failure = error; }
    return Promise.reject(error);
  }
  return Promise.resolve(result).then(
    value => { state.active--; return value; },
    error => {
      state.active--;
      if (!state.failed) { state.failed = true; state.failure = error; }
      throw error;
    },
  );
}

async function close(object) {
  const state = owners.get(object);
  if (state.active !== 0) {
    throw Object.assign(new Error('Moxley database has active operations'), { code: 'MOXLEY_BUSY' });
  }
  // Also invalidate a failed lifecycle, but never report successful closure.
  state.closed = true;
  if (state.failed) throw state.failure;
}

function guardPrototype(prototype) {
  for (const name of Object.getOwnPropertyNames(prototype)) {
    if (name === 'constructor') continue;
    const original = prototype[name];
    const asynchronous = original.constructor.name === 'AsyncFunction';
    prototype[name] = function (...args) {
      // Preserve the promise-returning API, including post-close refusals.
      if (asynchronous) {
        try { return run(this, () => original.apply(this, args), true); }
        catch (error) { return Promise.reject(error); }
      }
      return run(this, () => original.apply(this, args));
    };
  }
}

module.exports = { attach, assertOpen, run, close, guardPrototype };
