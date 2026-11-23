# Dockyard Admin migration plan

The global RBAC role named Super Admin remains the system administrator. The existing global Admin role remains for compatibility. Dockyard authority is evaluated from membership in the specific Dockyard.

1. Before migration, inspect the target migration ledger, count Owner memberships and Dockyards without an Owner, and check for emails that collide after trimming and lowercasing. Resolve missing administrators or email collisions explicitly before proceeding.
2. Pause application writers. Rename the existing PostgreSQL enum value from `OWNER` to `ADMIN` in place. Add optional designation, a unique normalized-email index and a dedicated account creation audit table. Keep existing email spelling, role rows, memberships, credential records and sessions. The migration rejects preflight failures in a single transaction.
3. Deploy the regenerated Prisma client, API and dashboard together. Confirm the administrator count and membership identities match the preflight, then verify authentication and Dockyard access before resuming writes.
4. For rollback, stop writers and use a reviewed forward migration to rename the enum label from `ADMIN` back to `OWNER`, then restore the matching application version. Keep the additive column, index and audit table to preserve data created after release. Never edit an applied migration or restore a snapshot over newer live data without an approved recovery decision.

Validation applies migrations only to disposable PostgreSQL databases. The current provisioning flow requires a Super Admin and a Dockyard membership in the same transaction as the new account.

## Read-only preflight

```sql
SELECT count(*) FROM "DockyardMember" WHERE role::text = 'OWNER';

SELECT count(*) FROM "Dockyards" d
WHERE NOT EXISTS (
  SELECT 1 FROM "DockyardMember" m
  WHERE m."dockyardId" = d.id AND m.role::text = 'OWNER'
);

SELECT count(*) FROM (
  SELECT lower(btrim(email)) FROM "user" WHERE email IS NOT NULL
  GROUP BY 1 HAVING count(*) > 1
) AS collisions;
```

The second and third counts must be zero. After migration, count `ADMIN` instead of `OWNER` and compare membership IDs and assignments with the preflight snapshot.

## API compatibility

- Member requests and responses now use `ADMIN`. Existing IDs and assignments carry over. Historical audit JSON and historical migration SQL retain their original labels.
- `POST /api/users` requires `email`, `password`, `dockyardId`, and `role`. The normalized email is the login ID. The password must contain 8–128 characters and the role must be `ADMIN`, `MANAGER`, or `VIEWER`.
- The earlier migration's nullable designation column is retained to preserve stored values. The simplified workflow requires no additional migration.
- Public Better Auth account creation is disabled for email, Google and phone OTP. The existing sign-in flows for provisioned users and the explicit offline Super Admin bootstrap remain separate.
- The migration implements normalized uniqueness as a PostgreSQL expression index. Retain it when reviewing generated schema changes.
