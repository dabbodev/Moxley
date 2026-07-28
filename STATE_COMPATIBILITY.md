# Moxley State Compatibility Policy

Status: Policy selected; runtime detector and migration unimplemented.
Date: 2026-07-28
Authority baseline: `518ab5ab58500a84246770e8ef0180856e127abd`

The authority baseline is a repository behavior baseline. It is not a persisted-format version or package release.

## 1. Evidence

The historical behavior characterized before the authority baseline showed that `_create('descendant')` wrote a non-root `0/_state.ms` containing:

- `_loc` pointing at physical child directory `0`;
- `_id` `0`;
- `_name` `root`;
- `_keys` `[]`; and
- `_bindings` `[]`.

The finalized in-memory child instead had `_id` `0/0` and `_name` `descendant`. An ordinary reopen consumed the provisional persisted name, reconstructed the child as `root`, and could create a `root.ml` binding artifact.

PR #11 changes only new `_create()` writes so that the finalized `_id` and `_name` are persisted after child construction. It deliberately leaves historical provisional child-state bytes untouched. Current ordinary loading still accepts the characterized historical shape and can reproduce its historical reconstruction and binding-artifact behavior.

No persisted-format identifier or version is currently stored. The observed fixture shape is evidence for the specific characterized scenario, not a general detector. In particular, `_id: "0"` and `_name: "root"` alone are not a complete or authoritative way to identify every historical database or child state.

## 2. Selected policy

- Ordinary load must never silently migrate historical state.
- A future hardened runtime must fail closed when an exact, separately approved detector identifies historical provisional child state.
- Fail-closed behavior means rejection without rewriting child state, deleting files, synthesizing replacement bindings, or claiming successful readiness.
- Silent normalization, automatic rewrite, best-effort continuation, and implicit `root.ml` cleanup are prohibited.
- Historical state remains unqualified until an explicit migration succeeds or a separately approved compatibility policy supersedes this decision.
- Newly corrected state is only a candidate baseline for future qualification. It is not yet a released or durable format.

Current code does not implement the detector or rejection behavior. This document selects policy; it does not claim that the runtime already enforces it.

## 3. Detector prerequisites

Before detector implementation, a separate bounded contract must define:

- the complete evidence needed to distinguish a root state from a non-root child state;
- parent/child location consistency;
- expected physical directory identity;
- named-link consistency;
- exact accepted and unsupported state shapes;
- traversal and error precedence;
- whether validation is whole-database preflight or incremental;
- the point before which no filesystem write may occur;
- stable error type, code, and message fields;
- preservation of the original parsing or filesystem error as a cause where applicable;
- resource limits and symlink/path policy; and
- deterministic behavior across processes.

This policy does not invent or approve a detector, error code, or API.

## 4. Explicit migration requirements

Migration, if later approved, must be a separate operation rather than an ordinary-load side effect. Before implementation, its contract must define:

- source and target format identities;
- complete eligibility checks;
- backup or copy-on-write behavior;
- deterministic dry-run and evidence report;
- exact transformed files and fields;
- handling of ambiguous names and IDs;
- atomic commit or a recoverable journal;
- interruption and restart behavior;
- rollback boundary;
- post-migration verification;
- original-data retention and deletion authority; and
- package/version compatibility.

No migration path is approved by this document.

## 5. Compatibility and release boundary

- Repository `package.json` remains at version `3.1.1`.
- Historical npm `moxley-db@3.2.0` remains separate published evidence.
- No new package release, tag, or persisted-format version exists.
- PR #11 leaves the state object shape and filenames unchanged but changes the values written for newly created child `_id` and `_name`.
- Old and new state can therefore coexist, but coexistence is not proof of compatibility.
- A future hardened release must state whether it supports only fresh corrected databases or also an explicit migrated baseline.
- No Thoth durability claim may rely on historical provisional state.

## 6. Deferred independent decisions

The following decisions remain separate from this policy:

- duplicate `_create(name)` policy;
- an ensure/get-or-create API;
- stable persisted identity;
- directory-order identity;
- paths and symlinks;
- locking and concurrency;
- atomicity, recovery, and durability; and
- package and persisted-format versioning.

## 7. Nonclaims

This policy does not:

- repair or migrate existing databases;
- implement runtime rejection;
- identify every possible historical state;
- make current `master` production-safe;
- qualify Moxley for Thoth; or
- authorize npm publication or a release.

## 8. Next slice

The next bounded slice is a detector-contract and test-plan sprint. It must define exact input evidence and error behavior before any production source changes.
