import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { env } from '../config/env.js';

// Stable application-wide lock key. Concurrent instances wait for the first
// migration run to finish instead of applying the same DDL twice.
const MIGRATION_LOCK_ID = 0x544f5543;

function hasSql(statement: string): boolean {
  return (
    statement
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/--.*$/gm, '')
      .trim().length > 0
  );
}

function describeError(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 3; depth += 1) {
    if (current instanceof Error) {
      if (!messages.includes(current.message)) messages.push(current.message);
      current = (current as { cause?: unknown }).cause;
    } else {
      if (current !== undefined && current !== null) messages.push(String(current));
      break;
    }
  }
  return messages.join(' | ') || 'unknown error';
}

async function main() {
  // Resolve from this module so both `tsx src/database/migrate.ts` and
  // `node dist/database/migrate.js` find backend/drizzle regardless of cwd.
  const migrationsFolder = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../drizzle',
  );

  let migrations: MigrationMeta[];
  try {
    migrations = readMigrationFiles({ migrationsFolder });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read migrations from ${migrationsFolder}: ${message}`);
  }

  if (migrations.length === 0) {
    throw new Error(
      `No migrations found in ${migrationsFolder}. Run "pnpm db:generate" and commit the generated SQL before migrating.`,
    );
  }

  migrations.forEach((migration, index) => {
    if (!migration.sql.some(hasSql)) {
      throw new Error(`Migration ${index + 1} contains no SQL statements.`);
    }
  });

  // Use one dedicated connection so the advisory lock and migration run on the
  // same PostgreSQL session. A session lock is released automatically if the
  // process dies, and the finally block releases it on normal failures.
  const connection = postgres(env.DATABASE_URL, { max: 1, connect_timeout: 10 });
  try {
    await connection`select pg_advisory_lock(${MIGRATION_LOCK_ID})`;
    try {
      const migrationDb = drizzle(connection);
      await migrate(migrationDb, { migrationsFolder });
    } finally {
      await connection`select pg_advisory_unlock(${MIGRATION_LOCK_ID})`;
    }

    const rows = await connection<{ count: number }[]>`
      select count(*)::int as count from drizzle.__drizzle_migrations
    `;
    const applied = rows[0]?.count ?? 0;

    if (applied < migrations.length) {
      throw new Error(
        `Migration tracking is incomplete: ${applied} of ${migrations.length} migrations recorded.`,
      );
    }

    console.log(
      `Database migrations applied successfully (${applied} recorded migration(s), ${migrations.length} migration file(s)).`,
    );
  } finally {
    await connection.end();
  }
}

try {
  await main();
} catch (error) {
  console.error(`Migration failed: ${describeError(error)}`);
  process.exitCode = 1;
}
