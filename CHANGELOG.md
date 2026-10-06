# Changelog

## 4.0.0 - local release candidate, 2026-10-06

This source is prepared for local artifact qualification. It has not been
published, tagged, released remotely, or admitted into a production dependency.

### Compatibility

The highest prior npm release is 3.2.0. The successor requires Node 16 or newer
for node-prefixed CommonJS builtins and crypto.randomUUID; earlier runtime
compatibility is not preserved. This motivates a major version despite the
additive close API and bug fixes. Qualification currently covers Windows x64,
Node 24.13.0 and npm 11.12.1 only. No prior prerelease/tag convention was found;
4.0.0 is an ordinary version held locally as a candidate.

### Runtime changes since 3.2.0

- Await descendant loads and propagate their failures; repeated loads reuse
  existing children and newly created child metadata is finalized.
- Publish each persistent file by complete same-directory staging and rename,
  preserving committed preimages on ordinary filesystem failure. Replacement
  may change file identity, ACLs, hard-link relationships and symlink behavior;
  ordinary files on a filesystem supporting same-directory atomic replacement
  are the qualified boundary.
- Add await moxley.close(), root-wide invalidation, busy refusal, repeat-close
  idempotence and preservation of the original asynchronous lifecycle cause.
- Include the existing optional Windows native qualification/build tools and
  their bounded admission contract. These tools do not become a runtime loader.

### Packaging

- Retain moxley-db identity, index.js CommonJS entry point, existing deep-import
  access, and flatted ^3.0.2; no exports map, binary, bundled dependency, install
  hook or native auto-build is added.
- Synchronize version metadata, explicitly declare intended distribution
  members, include close/publication/legal documentation, and include focused
  npm-pack/consumer-install regressions. Canonical npm test now includes the
  existing atomic and close suites; test:package exercises fresh packing.
- Retain Apache-2.0 LICENSE, NOTICE and LICENSING.md with the copyright holder's
  historical 3.2.0 licensing clarification. Separately installed flatted retains
  its own license.

### Persisted-state limits

The writer still emits the existing unversioned persisted layout. No marked
version-1 format, migration, complete historical-state support or persistence
certificate is introduced. Read STATE_COMPATIBILITY.md before reopening state.
Single-file atomic replacement and close supply no multi-file transaction,
fsync/stable-storage durability, crash/power-loss recovery, journaling,
cross-process exclusion, or full durable OEWN claim.
