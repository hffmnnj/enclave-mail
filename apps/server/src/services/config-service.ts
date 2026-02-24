import { type DbClient, db, systemConfig } from '@enclave/db';
import { eq } from 'drizzle-orm';

export type ConfigKey = 'registration_enabled' | 'domain';

export interface ConfigServiceDeps {
  dbClient: DbClient;
}

export const createConfigService = (deps: ConfigServiceDeps) => ({
  async getConfig(key: ConfigKey): Promise<unknown | null> {
    const rows = await deps.dbClient
      .select({ value: systemConfig.value })
      .from(systemConfig)
      .where(eq(systemConfig.key, key));

    const row = rows[0];
    return row ? row.value : null;
  },

  async setConfig(key: ConfigKey, value: unknown): Promise<void> {
    await deps.dbClient
      .insert(systemConfig)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: systemConfig.key,
        set: { value, updatedAt: new Date() },
      });
  },
});

export const configService = createConfigService({ dbClient: db });
