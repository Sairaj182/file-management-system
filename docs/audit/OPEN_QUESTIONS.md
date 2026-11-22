# Decisions requiring product/owner input

These decisions affect implementation boundaries. Resolved: Dockyard and Warehouse are the same product concept; retain the existing Dockyards model/relationships as the Warehouse identity, preserve all rows, and do not create a duplicate Warehouse model. Continue to preserve current auth/DB foundations; prioritize a local-storage self-hosted MVP; do not claim unimplemented file features exist.

1. **Warehouse authorization:** What membership and ownership policy should govern users within each Dockyard/Warehouse? The Phase 0 create route requires CREATE_ANY and records the authenticated creator; scoped membership policy is a Phase 1 decision.
2. **Initial deployment:** Single host/local disk, or multiple API instances and S3-compatible storage from the first release? What availability and recovery targets are required?
3. **User onboarding:** Should users self-register, be invited/admin-created, or be provisioned through an external identity provider? Are phone OTP and Google sign-in actually VaultFS requirements?
4. **Role policy:** Can Admin create other Admins? Which actions are globally privileged, and which are warehouse-scoped? Is SuperAdmin a protected system role only?
5. **API key scope:** Should keys be limited to one warehouse and specific operations (read/write/delete)? Required expiry, rotation grace period, and last-used update cadence?
6. **Upload policy:** Maximum file size/count, allowed/restricted content types, archive handling, checksum algorithm, retention, and malware scanning requirement for MVP?
7. **Deletion/retention:** Hard delete, recoverable soft delete, retention window, legal hold, and behavior when object deletion fails?
8. **Signed URL semantics:** Maximum lifetime, allowed methods, one-time versus replayable access, revocation requirements, and whether downloads must require a session even with a link?
9. **Verification:** What does “verified” mean (checksum integrity, admin review, malware verdict, business approval), and who may reverse it?
10. **Production target:** Supported OS/container platform, reverse proxy/TLS termination, backup destination, monitoring stack, RPO/RTO, and expected tenants/files/throughput?
11. **Dashboard/API release order:** Is a functional API plus docs acceptable as the first MVP, or are admin/user dashboards release blockers?
12. **Existing data:** Is there any non-repository deployment data or undocumented application that depends on Dockyard, auth, or current API response shapes? Migration compatibility should be decided before changing schema or routes.
