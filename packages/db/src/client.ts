import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

export type DbClient = ReturnType<typeof createDbClient>;

export const createDbClient = (connectionString: string) => {
  const pool = new pg.Pool({ connectionString });
  return drizzle(pool, { schema });
};

export const db = createDbClient(process.env.DATABASE_URL!);
