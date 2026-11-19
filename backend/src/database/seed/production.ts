import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { env } from '../../config/env.js';
import * as schema from '../schema/index.js';
import { seedMissingSecurity } from './security.js';

// Separate from the migration lock. Concurrent deploy instances serialize the
// insert-only seed so they cannot race on the same canonical roles.
const SECURITY_SEED_LOCK_ID = 0x544f5553;

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
  const connection = postgres(env.DATABASE_URL, { max: 1, connect_timeout: 10 });
  try {
    await connection`select pg_advisory_lock(${SECURITY_SEED_LOCK_ID})`;
    try {
      const counts = await seedMissingSecurity(drizzle(connection, { schema }));
      console.log(
        `Security roles seeded successfully (${counts.rolesInserted} new role(s), ${counts.permissionsInserted} new permission(s), ${counts.grantsInserted} new grant(s)).`,
      );
    } finally {
      await connection`select pg_advisory_unlock(${SECURITY_SEED_LOCK_ID})`;
    }
  } finally {
    await connection.end();
  }
}

try {
  await main();
} catch (error) {
  console.error(`Security seed failed: ${describeError(error)}`);
  process.exitCode = 1;
}
