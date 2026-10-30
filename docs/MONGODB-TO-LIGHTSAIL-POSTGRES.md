# MongoDB to Lightsail PostgreSQL migration

The backend uses PostgreSQL whenever `DATABASE_URL` is configured. MongoDB stays
connected only as the source during the one-time copy.

Run the copy from the Lightsail application instance. The PostgreSQL database
is private and accepts same-region Lightsail resources only.

1. Put the private PostgreSQL connection string in deployment secrets as
   `DATABASE_URL`; set `DATABASE_SSL=true`.
2. Keep `MONGODB_URI` and `MONGODB_DATABASE` for the migration.
3. Stop the API and write-capable workers briefly, or use a maintenance window,
   so the source does not change during copying.
4. Set `MIGRATION_CONFIRM=COPY_MONGO_TO_POSTGRES` and leave
   `MIGRATION_ALLOW_TARGET_DATA=false` for a new target.
5. Enable Lightsail database Import mode, run `npm run db:migrate:postgres`,
   then disable Import mode.
6. Run `npm run db:check`, start API/workers with `DATABASE_URL`, and test
   login, profiles, CV metadata, job search, saved jobs, and applications.
7. Compare the `MIGRATION_COMPLETE` total with the per-collection reports.
   Each report has a canonical SHA-256 digest and fails if a row is absent,
   duplicated, or differs from MongoDB.

Do not remove MongoDB settings, delete Atlas data, or stop Atlas until the live
site and a Lightsail snapshot/restore test have passed. For a reviewed retry
against data copied by this tool, set `MIGRATION_ALLOW_TARGET_DATA=true` only
for that migration command; it will upsert and verify each collection again.
