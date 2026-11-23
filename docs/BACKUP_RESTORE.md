# VaultFS backup and restore

Recover PostgreSQL metadata, the object volume and the secret configuration from the same maintenance window. PostgreSQL does not contain the file bytes. Retain the image digests, schema migration status and release configuration alongside a backup manifest. Keep credentials encrypted in a separate secret store and record which secret versions belong to the backup.

## Backup

Use the deployment Compose project and its matching restricted configuration. Pause upstream traffic and stop API/web instances, workers and other writers. Leave PostgreSQL running. Confirm the API has drained. Use a custom-format PostgreSQL dump and archive the mounted object directory without changing ownership:

```sh
dc stop web api
dc exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/vaultfs.dump'
dc cp postgres:/tmp/vaultfs.dump ./vaultfs.dump
dc run --rm --no-deps -T api tar -C /var/lib/vaultfs -cf - . > vaultfs-objects.tar
dc up -d --wait
```

Use a binary-safe shell or subprocess stream for tar redirection. Hash both artifacts and copy them to encrypted off-host storage. Preserve `BETTER_AUTH_SECRET`, `JWT_SECRET` and `FILE_SIGNING_SECRET` by version and supply database credentials appropriate to the restore environment. Existing API-key digests and session rows travel in the metadata dump. The dump does not reveal raw API keys.

## Restore

Restore into a new Compose project with empty volumes and different host ports. Select the matching release image and adjust public URLs for that environment. Rebuild the web image if the public API URL shown to users changes. Start PostgreSQL, copy in the dump, then run `pg_restore --exit-on-error` against the empty database. Extract the trusted object archive with a one-shot API service using the new volume. In the example, `restore` invokes Compose with the restore environment file and project name.

```sh
restore up -d --wait postgres
restore cp ./vaultfs.dump postgres:/tmp/vaultfs.dump
restore exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --exit-on-error /tmp/vaultfs.dump'
restore run --rm --no-deps -T api tar -C /var/lib/vaultfs -xf - < vaultfs-objects.tar
restore up -d --wait
```

Use the restored configuration to confirm login, role access and download. Compare byte count and SHA-256 from metadata against the downloaded bytes. Check an existing credential and a still-valid signed URL. Review recovery of pending or quarantined rows separately. Keep the source environment intact until the restore is verified.

Filesystem and PostgreSQL snapshots are independent. Taking them live can capture an upload or deletion in only one side of the backup. A stopped writer maintenance window gives this procedure its consistency guarantee. Recoverable state goes back to the last matching backup pair. A signed link can expire while recovery is in progress. Restore duration depends on the database, object volume and local disk.
