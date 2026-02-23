import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { type DbClient, createDbClient } from './client.js';

export const runMigrations = async (dbClient: DbClient) => {
  console.log('[migrate] Running pending migrations...');
  await migrate(dbClient, { migrationsFolder: './drizzle' });
  console.log('[migrate] Migrations complete.');
};

const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[migrate] DATABASE_URL environment variable is required.');
    process.exit(1);
  }

  const client = createDbClient(connectionString);
  runMigrations(client)
    .then(() => {
      console.log('[migrate] All migrations applied successfully.');
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error('[migrate] Migration failed:', error);
      process.exit(1);
    });
}
