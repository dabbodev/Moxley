# Single-file atomic publication and replacement

Ordinary synchronous publication of one runtime persistent file stages the
complete intended bytes in an exclusively created sibling temporary file,
closes that file, then renames it over the destination. The destination is
never truncated or unlinked as a preparation step. No copy or unlink fallback
is used when the platform refuses replacement.

The bounded private basename is `.moxley-publish-<UUID>.tmp`. It shares the
destination directory and filesystem, does not depend on a logical key, and
has none of the runtime state suffixes. Directory reconstruction ignores
entries containing a dot, and lazy key lookup only reads `.md`, `.ml`, or
`.mf`; publication temporaries therefore cannot supply keys or children.
Exclusive creation prevents claiming or deleting an existing temporary file.

On ordinary open, write, close, or rename failure, a first destination remains
absent and an existing committed destination retains its exact prior bytes.
The original filesystem error is thrown unchanged. Closing and removing an
owned staging file is best effort; cleanup errors never replace the primary
failure. A cleanup failure can leave an ignored temporary file. This primitive
does not scan or remove temporaries left by another process or a past crash.

Successful persisted bytes, logical filenames, and directory placement are
unchanged. Filesystem metadata such as inode/file identity, timestamps, ACLs,
hard-link relationships, or symbolic-link behavior is not a compatibility
guarantee of replacement. Qualified ordinary runtime destinations are files
in a filesystem supporting atomic same-directory rename/replacement. An
unsupported or refused rename propagates the platform error.

## Persistent publication inventory

| Caller | Destination and intended bytes | Memory ordering and larger operation |
| --- | --- | --- |
| `DB._saveState()` | `_state.ms`, unchanged flatted node metadata | Reads current metadata; often follows already published values/children/bindings. |
| `DC._saveState()` | `_colstate.mc`, unchanged flatted collection metadata | Collection membership/order may already have changed; associated links are separate publications. |
| Proxy data assignment | `<key>.md`, unchanged flatted value | Publishes before adding the key or invoking hooks; `_set()` subsequently publishes node metadata. |
| Proxy node-link assignment | `<key>.ml`, unchanged target ID string | Publishes before adding the key; child allocation and state/link files are separate publications. |
| Proxy function assignment | `<key>.mf`, unchanged function source string | Publishes before adding the key; caller metadata publication is separate. |

Each site handles both first publication and replacement through the one
private helper in `lib/atomic-file-publication.cjs`. Failure exposes no prefix
of that file and fresh reads retain the previous file or absence. It does
not reverse previous publications belonging to the enclosing operation,
restore in-memory mutations, or make an acknowledgement after several files
transactional. Reopening can still encounter unrelated historical identity,
ordering, collection, or lifecycle defects.

Native build and cleanup scripts have separate qualified artifact/lease
protocols and test-only fixture writes. They are not database runtime
publication sites; their historical retention and custody contracts remain
unchanged and are covered by their existing canonical suites. No runtime
persistent write is exempted from this helper.

## Qualification boundary

The contract is `SINGLE_FILE_ATOMIC_PUBLICATION_REPLACEMENT`. Regression tests
inject ordinary failures at open, partial write, close, and rename; compare
exact preimages; read from fresh processes; cover all five suffixes; and
exercise cleanup failure, collision ownership, and actual platform errors.

This supplies no database transaction, multi-file atomicity, `_store()` or
child-create transactionality, collection transactionality, cross-process
locking, durable fsync acknowledgement, crash/power-loss safety, journaling,
recovery, rollback, close lifecycle, or complete persistence correctness.
