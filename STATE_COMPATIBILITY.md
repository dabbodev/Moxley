# Moxley State Compatibility Policy

Status: Persisted-format discriminator selected; runtime writing, detection, enforcement, and migration unimplemented.
Date: 2026-07-28
Historical behavior baseline: `518ab5ab58500a84246770e8ef0180856e127abd`
Discriminator decision input baseline: `635a7c09bcca63c3abbb52d5c2fbbce4b87a9817`
Decision authority: David Giles, sole owner of Moxley

These repository baselines are evidence and decision inputs. Neither is a
persisted-format version, package release, or prediction of an eventual merge
commit.

## 1. Historical evidence

The historical behavior characterized before the historical behavior baseline
showed that `_create('descendant')` wrote a non-root `0/_state.ms` containing:

- `_loc` pointing at physical child directory `0`;
- `_id` `0`;
- `_name` `root`;
- `_keys` `[]`; and
- `_bindings` `[]`.

The finalized in-memory child instead had `_id` `0/0` and `_name`
`descendant`. An ordinary reopen consumed the provisional persisted name,
reconstructed the child as `root`, and could create a `root.ml` binding
artifact.

PR #11 changed only new `_create()` writes so that the finalized `_id` and
`_name` are persisted after child construction. It deliberately left
historical provisional child-state bytes untouched. Current ordinary loading
still accepts the characterized historical shape and can reproduce its
historical reconstruction and binding-artifact behavior.

Current `master` does not store a persisted-format identifier or version.
Historical and current unversioned root `_state.ms` bytes can be
indistinguishable because PR #11 changed finalized child-state values, not the
root-state format. Structure alone therefore cannot establish whether an
otherwise identical root is historical, current, qualified, or version 1.

At the decision input baseline, PR #12 truthfully selected the
no-silent-migration policy and stopped before choosing a persisted-format
discriminator. This later owner decision resolves that one ambiguity without
rewriting the earlier decision history.

## 2. Already-selected no-silent-migration policy

- Ordinary load must never silently migrate historical or otherwise
  unversioned state.
- A future hardened runtime must fail closed when persisted state is
  unqualified or when an exact, separately approved detector rejects it.
- Fail-closed behavior means rejection without rewriting state, deleting
  files, synthesizing replacement bindings, or claiming successful readiness.
- Silent normalization, automatic rewrite, best-effort continuation, and
  implicit `root.ml` cleanup are prohibited.
- `_saveState()` must never convert legacy state merely because a legacy
  database was opened or mutated.
- Migration remains a separate, explicit, later-authorized operation.

Current code does not implement that detector or rejection behavior. These are
policy requirements, not claims of runtime enforcement.

## 3. Selected future persisted-format discriminator

On 2026-07-28, David Giles selected boundary 2: future-created databases will
carry an explicit, root-owned persisted-format discriminator and version.

The exact logical marker in the parsed root `_state.ms` object is:

```json
{
  "_format": "moxley-db",
  "_formatVersion": 1
}
```

These fields are additional to the existing root-state fields.

- `_format` is the exact case-sensitive string `moxley-db`.
- `_formatVersion` is the JSON number and integer `1`, not the string `"1"`.
- The marker belongs only in the root `_state.ms`.
- Child `_state.ms`, collection `_colstate.mc`, named `*.ml` bindings, data
  files, functions, and templates must not carry the root marker.
- Object-property order and insignificant JSON or flatted framing are not
  semantic.
- Detection must operate on the parsed logical value, not substring matching.
- A matching marker is necessary but not sufficient for accepting a database.
  Later whole-database preflight must still validate all required structural
  evidence.
- Version 1 is a persisted-layout compatibility identifier. It is not an npm
  package version.

The structural-only alternative is rejected. Byte-identical unversioned
historical and current roots cannot be made qualified by inference, and a
future hardened loader must not infer a version from otherwise identical
structure.

## 4. Creation, legacy, and enforcement boundary

- Current `master` does not emit the marker.
- No existing database is retroactively version 1.
- Every database created before the future marker-writing implementation
  remains unversioned, including databases created after PR #11 and before
  that future implementation.
- An unversioned root is legacy, unqualified persisted state.
- Missing `_format`, missing `_formatVersion`, malformed marker values, unknown
  format names, unsupported versions, or a root marker appearing only below
  the root must fail closed once enforcement exists.
- Unknown future versions must not fall back to version 1 behavior.
- Ordinary load must not add the marker to an unversioned database.
- `_saveState()` must not add it as a side effect of opening or mutating legacy
  state.
- Mere absence of `_state.ms` inside an existing directory is not proof that
  the directory is a fresh database.
- The future creation implementation must establish new-database status before
  its first write and include the marker in the first persisted root state.
- This decision does not choose or add a new public create or open API.

The documentation decision alone does not cause version 1 state to exist.
Until separately approved writing and enforcement are implemented, there is no
runtime-supported version 1 database.

## 5. Persisted-format versioning policy

- Persisted-format versions are independent of npm/package SemVer.
- A package release must explicitly state which persisted-format versions it
  reads and writes.
- Writers emit one exact supported version.
- Readers fail closed for unsupported versions.
- An incompatible change to required files, field interpretation, identity
  rules, or structural invariants requires a new persisted-format version.
- Runtime-only fixes that do not alter accepted or emitted persisted structure
  do not automatically require a format-version increment.
- Version 1 is reserved for the future marker-writing implementation and its
  separately approved structural contract.
- This documentation decision does not create version 1 state.
- No tag, release, npm publication, or package-version change is authorized.

Repository `package.json` remains `moxley-db@3.1.1`. That package version does
not identify a persisted format.

## 6. Behavior not yet implemented

This decision record does not implement:

- writing the marker during creation;
- a fresh-versus-existing-directory decision;
- parsed-value marker detection;
- whole-database preflight or traversal;
- fail-closed loader enforcement;
- a public or exported detector API;
- migration, repair, normalization, or legacy conversion; or
- support for any persisted-format version.

No runtime may cite this document alone as evidence that it reads or writes
version 1.

## 7. Remaining detector prerequisites

Before detector implementation, later bounded contracts and evidence must
define:

- the full accepted version-1 state schema and all required files;
- complete root, child, collection, binding, data, function, and template
  evidence;
- parent/child location consistency and physical directory identity;
- named-link and persisted identity rules;
- whole-database traversal and deterministic error precedence;
- the point before which no filesystem write may occur;
- path containment and the symlink or junction policy;
- resource limits;
- stable error class, code, and complete wire shape;
- preservation of original parsing or filesystem errors where applicable; and
- deterministic behavior across processes.

The matching marker remains only the first gate. Byte-level separability must
be proven before any of these detector decisions or runtime changes.

## 8. Deferred independent decisions

This record does not select or implement:

- the full accepted version-1 state schema;
- detector traversal or source code;
- a public or exported detector API;
- a stable error class, error code, or complete error wire shape;
- numeric resource limits;
- symlink or junction policy;
- path-containment implementation;
- migration;
- automatic repair or normalization;
- duplicate `_create(name)` behavior;
- locking or concurrent-writer behavior;
- atomicity, journaling, recovery, or durability;
- cancellation; or
- adapter or Thoth behavior.

Those decisions remain later work after byte-level separability is proven.

## 9. Explicit nonclaims

This policy does not:

- claim any existing database is version 1;
- repair, migrate, normalize, or reclassify existing databases;
- implement runtime writing, detection, rejection, or structural preflight;
- make current `master` production-safe;
- claim locking, atomicity, journaling, recovery, durability, concurrency
  safety, or general production readiness;
- qualify Moxley for Thoth or alter any Thoth behavior;
- change package or persisted data; or
- authorize a tag, release, npm publication, or package-version change.

## 10. Next independently testable slice

The next slice must be fixtures and characterization only. It must preserve
byte-complete, final-framing-exact preimages for:

- an unversioned historical root-only database;
- an unversioned historical nested database;
- the current unversioned post-PR #11 candidate; and
- a synthetic proposed version-1 root marker candidate.

That later slice must independently prove:

- unversioned and marked roots are mechanically distinguishable;
- no historical preimage is reclassified as version 1;
- marker name, type, case, and version mismatches are distinguishable;
- root-only ownership of the marker can be tested; and
- the proposed fixture bytes do not claim runtime support.

That slice must not implement production detection, loading, writing,
migration, repair, or enforcement. No fixture or test is added by this
documentation-only decision.
