# Migrations

Committed Drizzle migrations for the TOUCHLINE PostgreSQL schema.

- `0000_cute_speed.sql` creates the 23 tables and enum types defined in `src/database/schema/index.ts`.
- `meta/_journal.json` and `meta/0000_snapshot.json` are generated metadata and must stay in sync with the SQL files.

Generate a new migration after a schema change, review the SQL, and commit the SQL file plus metadata:

```bash
pnpm db:generate
pnpm db:migrate
```

`pnpm db:migrate` validates the journal, SQL and tracking table and exits non-zero on missing, empty or invalid migrations or database failures. Do not hand-edit an applied migration; add a new one instead.
