import { sql } from '../client.js';
import { seedSecurity } from './security.js';

try {
  await seedSecurity();
  console.log(
    'Roles and permissions seeded. Competition/team seed intentionally omitted pending organizer name reconciliation.',
  );
} finally {
  await sql.end();
}
