import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Apply the idempotent setup.sql schema to the database.
 *
 * All statements use IF NOT EXISTS / IF NOT THEN guards, so this is safe
 * to run on every server startup or as a standalone migration command.
 */
export async function runMigrations(connectionString?: string): Promise<void> {
  const connStr = connectionString ?? process.env.DATABASE_URL;
  if (!connStr) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const setupPath = join(__dirname, 'setup.sql');
  const setupSql = readFileSync(setupPath, 'utf-8');

  const pool = new pg.Pool({ connectionString: connStr });
  try {
    console.log('[db:migrate] Applying migrations...');
    await pool.query(setupSql);
    console.log('[db:migrate] Migrations complete.');
  } finally {
    await pool.end();
  }
}

// Run directly when invoked as a script
const isMain =
  typeof import.meta.main === 'boolean'
    ? import.meta.main
    : import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  runMigrations().catch((err: unknown) => {
    console.error('[db:migrate] Migration failed:', err);
    process.exit(1);
  });
}
