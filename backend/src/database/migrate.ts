import { resolve } from 'node:path';
import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, sql } from './client.js';

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
  const migrationsFolder = resolve(process.cwd(), 'drizzle');

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

  await migrate(db, { migrationsFolder });

  const rows = await sql<{ count: number }[]>`
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
}

try {
  await main();
} catch (error) {
  console.error(`Migration failed: ${describeError(error)}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
