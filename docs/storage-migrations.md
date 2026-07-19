# Account database migration policy

AURA stores every identity in a physically separate Dexie database named `aura-r1:<account-pubkey>`. Schema changes are security- and delivery-sensitive because messages, exact wire events, outbox ownership and replay cursors must remain mutually consistent.

## Rules

1. Never edit an already released Dexie version definition.
2. Every schema change adds a monotonically increasing `database.version(N)` block.
3. Prefer additive tables/indexes. Do not rewrite encrypted event JSON unless a protocol migration requires it.
4. Upgrade callbacks run inside Dexie’s migration transaction and must be deterministic and idempotent with respect to the source version.
5. Do not perform network calls, clipboard calls, WebAuthn operations or UI state changes from a migration.
6. Do not delete legacy fields/tables in the same release that introduces their replacement. First migrate consumers, verify production, then schedule removal separately.
7. A failed migration must leave the previous database usable by the previous production release. Do not remove registry metadata before physical database deletion succeeds.
8. Never synthesize delivery/read evidence during migration. Only derive state from conclusive persisted wire/outbox/inbox evidence.
9. Never create a plaintext message/contact search index as a migration side effect.
10. Database upgrade must not require the Nostr secret key. Decryption-dependent repair happens only after unlock through an explicit, cancellable operation.

## Required tests for every new version

Create a fixture database at each supported prior version, close it, open it through the current `AccountDatabase`, then assert:

- every message, state history and exact wrap ID is preserved;
- every `wireCopies.eventJson` byte string is unchanged;
- queued/retry/publishing ownership fields remain unchanged unless the migration has a reviewed evidence-led repair;
- inbox receipts and relay cursors survive;
- account isolation remains physical;
- migration interruption/failure does not remove registry metadata or the old physical database;
- opening the already-upgraded database again is a no-op;
- the full outbox reconciliation suite remains green.

## Rollback-safe schema rollout

A previously deployed Dexie bundle normally cannot open a database whose version is newer than every version it declares. Therefore a rollback-sensitive schema change ships in two releases:

1. **Compatibility release:** declare `version(N)` and run the tested additive migration, but keep all production reads/writes on the old schema surface.
2. Verify the compatibility release on physical devices and leave it active long enough to migrate Ring A databases.
3. **Feature release:** begin using the new table/index while retaining old consumer compatibility where required.
4. A rollback from the feature release goes only to the compatibility release, never directly to code that does not know `version(N)`.
5. Destructive cleanup, if ever justified, is a later independently reviewed release after the rollback window closes.

## Release procedure

1. Add RED migration fixture/test before the new schema.
2. Implement the smallest `version(N)` definition and upgrade callback.
3. Ship and verify the schema-only compatibility release.
4. Implement the feature against the already-deployed schema.
5. Run focused storage tests.
6. Run all unit/E2E/build gates.
7. Review migration and rollback behavior independently.
8. Test a production-like database copy locally; never experiment on the active production browser profile.
9. Deploy atomically and preserve the schema-compatible prior static release for rollback.

A static-code rollback cannot downgrade an IndexedDB schema. Do not deploy a feature release until its immediate rollback target already declares the same database version. If an emergency predates the compatibility release, recovery requires a tested forward fix rather than loading an older incompatible bundle.
