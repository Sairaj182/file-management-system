# VaultFS Checkpoint 2 — Additive Schema Proposal

Status: design recorded before implementation on 2026-11-18.

## Existing relationships and compatibility

- `Dockyards` is the existing Warehouse identity. Its `id`, `status`, `notes`, `createdById`, and timestamps remain intact.
- `Dockyards.createdById` already references the Better Auth `User` row and is the authoritative initial owner for each existing Dockyard.
- Existing `Api` rows reference `Dockyards` through `dockId` and reference their creator through `createdById`. They contain no credential material and must keep both IDs and relations.
- `User`, `Role`, and `Permission` are global identity/authorization models. Their role graph will not be used to imply Dockyard membership. In particular, global Admin will not grant resource access.
- Better Auth identity/session tables are not changed for this work.

## Proposed additive migration

1. Add resource-level `DockyardMemberRole` values `OWNER`, `MANAGER`, and `VIEWER`, plus a `DockyardMember` join table with a unique `(dockyardId, userId)` pair and lookup indexes. Existing Dockyard creators are inserted as owners with `ON CONFLICT DO NOTHING`; all existing Dockyard IDs remain unchanged.
2. Extend the existing `Api` table in place with nullable `keyDigest`, `name`, `expiresAt`, `revokedAt`, and `lastUsedAt`, plus an empty-by-default API key scopes array. Add a unique index for non-null digests. Existing `Api` rows remain valid but have no usable key until a future issuance checkpoint assigns a digest and scopes.
3. Add a file metadata table with an opaque storage key, filename/content metadata, size, checksum, and lifecycle state. No binary data is stored in PostgreSQL and no upload/download code is introduced in this checkpoint.
4. Add a Dockyard audit-event table that records the actor, resource, action, optional target user, and structured metadata. Super Admin cross-membership access is explicitly logged per Dockyard and action.
5. Keep foreign-key deletion behavior data-preserving: membership and existing Api references restrict hard deletion of a Dockyard or member user; file metadata restricts Dockyard deletion and preserves uploader metadata if a user is deleted; audit actor/target references become null on user deletion.

## Authorization and concurrency proposal

- `OWNER` can view and manage membership and can manage future file/key actions.
- `MANAGER` can view the Dockyard and manage future file/key operations, but cannot change membership.
- `VIEWER` can view the Dockyard and has future download permission only.
- A creator is inserted as `OWNER` in the same transaction as Dockyard creation.
- An active `Super Admin` may access a Dockyard through an explicit global path that writes an audit event. A global `Admin` has no automatic bypass.
- Every membership mutation locks its parent `Dockyards` row inside the transaction before reading/updating owner membership. Role changes away from `OWNER` and removals reject when they would leave zero owners. This serializes concurrent API mutations for one Dockyard.

## Proposed routes

Keep the current `/api/dockyard` prefix and create contract. Add accessible listing, `GET /:dockyardId`, and membership list/add/update/remove routes under the same prefix. Every route remains Better Auth session-authenticated; resource membership decides access after authentication.

## Safety gate

Apply the generated migration only to the disposable Phase 1 test database first. Compare pre/post Dockyard and Api ID counts, verify creator-owner backfill and constraints, then run real HTTP integration tests. No dev/production database or destructive migration is in scope.
