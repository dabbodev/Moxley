# Database close lifecycle

The public Moxley facade supports `await moxley.close()`. There is no separate
`_close` or node/collection close API. The facade owns the entire database
lifecycle. Placing the API on the facade preserves user values named `close`
in the database's existing property namespace.

Close checks the root-owned in-process activity count immediately. If an engine
operation is still active, it rejects with an Error whose `code` is
`MOXLEY_BUSY`, leaves the database open, and performs no storage work. Await the
outstanding lifecycle calls and retry. This refusal also covers descendant
loads, collection metadata loads started by construction, CSV loads, and
reentrant close from synchronous engine callbacks. No sleeps are needed to
establish readiness. The engine does not cancel or race a pending load.

At zero activity, close invalidates the shared root synchronously before its
returned promise resolves. Successful repeat calls resolve to `undefined`.
Node and collection reads, mutations, creation, queries, explicit loads and
persistence calls then fail with `MOXLEY_CLOSED`. Async methods obtained before
close retain their promise rejection API; synchronous methods and proxy reads
throw. Bound or retained engine methods still check the same root. Reflection
that reads or mutates proxy properties is also refused. `close` remains callable
on the facade after closure.

The first rejected asynchronous engine lifecycle operation is retained by exact
cause identity. Once quiescent, close invalidates that failed instance and
rejects with that original cause; every repeated close rejects with the same
cause. Collection construction cannot await its metadata load, so its rejected
load is observed and retained by the root rather than becoming an unhandled
rejection. Close makes no success claim for such an instance. Synchronous
operation errors retain their existing propagation and do not imply a failed
asynchronous lifecycle.

Close does not rewrite, flush, remove or create any database file. Lifecycle
state is private in a WeakMap and is never persisted. A new Moxley instance over
the same path has an independent open lifecycle; await its existing
`db._loadFromDir()` before use. No JavaScript state is transferred from the old
instance. Values already copied out of the database are ordinary user values;
close cannot revoke them. Direct mutation of raw implementation internals or
replacement of engine methods is not a supported API.

`ENGINE_RESOURCES_TO_RELEASE=0` after normal engine operations: synchronous I/O
closes its descriptors, and the runtime owns no timer, socket, watcher or
worker. Close establishes quiescence and invalidation, not OS resource theatre.
Arbitrary asynchronous work started by user functions is outside engine
lifecycle tracking. External manipulation of descriptors or both failed
descriptor-close attempts is outside this normal resource census.

The API is additive; callers that never close retain successful behavior.
Persisted formats, dependencies and package version remain unchanged.
Single-file atomic publication remains bounded by its existing contract.
`MULTI_FILE_ATOMICITY_NOT_AVAILABLE` remains true. Close establishes no fsync
durability, stable-storage acknowledgement, crash/power-loss safety, recovery,
journaling, rollback, transaction, multi-file commit or cross-process exclusion.
