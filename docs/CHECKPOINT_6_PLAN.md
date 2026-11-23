# Checkpoint 6 validation plan

1. Review checkpoint evidence and run existing tests. Separate source review, host tests, container tests and production requirements in the report.
2. Add a repeatable release Compose topology. Use a new project, random disposable secrets, private PostgreSQL networking and distinct loopback ports. Run migration and bootstrap explicitly. Check API and web health, cookie forwarding, trusted origins, non-root execution and volume ownership.
3. Run the browser workflow against the actual production builds. Upload a small fixture, verify downloads and signed links, recreate the API container and confirm the file survives. Check graceful stop and restart.
4. Exercise all seven test categories. Run a short bounded load against the isolated stack, measure workload percentiles, bytes, failures and container resources, and capture actual outcomes.
5. Stop writers and take a PostgreSQL dump and an object-volume archive. Restore into a second disposable Compose project, supply the original authentication and signing configuration from a separate secret source, and verify restored metadata and bytes through HTTP.
6. Document confirmed security issues, regressions, known limitations, release steps and the readiness checklist. Leave existing development and production data alone.

Initial inspection found that the development Compose publishes PostgreSQL, hard-codes container names, and accepts a database URL intended for host processes. API and web have no Compose health checks, the API has no graceful stop handler, and the health probe returns HTTP 200 even on database failure. The existing browser tests use host processes. Unit has no dedicated alias, and performance and consolidated reporting are missing.
