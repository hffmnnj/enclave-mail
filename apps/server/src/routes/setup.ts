import { type DbClient, db, users } from '@enclave/db';
import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';

import { type AuthVariables, authMiddleware, requireAdmin } from '../middleware/auth.js';
import { configService } from '../services/config-service.js';
import { dnsCheckService } from '../services/dns-check-service.js';
import { generateDnsRecords } from '../services/dns-records-service.js';
import { tlsService } from '../services/tls-service.js';

type SetupAppContext = { Variables: AuthVariables };

interface SetupRouterDeps {
  dbClient: DbClient;
  configSvc: Pick<typeof configService, 'getConfig' | 'setConfig'>;
  dnsCheckSvc: Pick<typeof dnsCheckService, 'checkDns'>;
  tlsSvc: Pick<typeof tlsService, 'triggerCertbot' | 'getCertificateStatus'>;
}

const domainRegex = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

const setDomainSchema = z.object({
  domain: z.string().trim().toLowerCase().min(4).regex(domainRegex, 'Invalid domain format'),
});

const setRegistrationSchema = z.object({
  enabled: z.boolean(),
});

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const parseJsonBody = async <TSchema extends z.ZodTypeAny>(
  c: Context<SetupAppContext>,
  schema: TSchema,
): Promise<{ success: true; data: z.infer<TSchema> } | { success: false; response: Response }> => {
  let body: unknown;

  try {
    body = await c.req.json();
  } catch {
    return {
      success: false,
      response: c.json(
        { error: 'INVALID_REQUEST', details: [{ message: 'Invalid JSON body' }] },
        400,
      ),
    };
  }

  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return {
      success: false,
      response: c.json({ error: 'INVALID_REQUEST', details: parsed.error.issues }, 400),
    };
  }

  return { success: true, data: parsed.data };
};

const readConfiguredDomain = async (
  deps: SetupRouterDeps,
): Promise<{ domain: string | null; isSetupComplete: boolean }> => {
  const rawDomain = await deps.configSvc.getConfig('domain');

  if (!isNonEmptyString(rawDomain)) {
    return { domain: null, isSetupComplete: false };
  }

  const domain = rawDomain.trim();
  return { domain, isSetupComplete: domain.length > 0 };
};

const checkHasUsers = async (deps: SetupRouterDeps): Promise<boolean> => {
  const rows = await deps.dbClient.select({ id: users.id }).from(users).limit(1);
  return rows.length > 0;
};

const runMiddleware = async (
  middleware: MiddlewareHandler<SetupAppContext>,
  c: Context<SetupAppContext>,
): Promise<Response | null> => {
  const result = await middleware(c, async () => {});
  return result ?? null;
};

const enforceAdminIfUsersExist = async (
  c: Context<SetupAppContext>,
  hasUsers: boolean,
): Promise<Response | null> => {
  if (!hasUsers) {
    return null;
  }

  const authResult = await runMiddleware(authMiddleware, c);
  if (authResult) {
    return authResult;
  }

  return runMiddleware(requireAdmin, c);
};

const lookupUserIsAdmin = async (deps: SetupRouterDeps, userId: string): Promise<boolean> => {
  const rows = await deps.dbClient
    .select({ id: users.id, isAdmin: users.isAdmin })
    .from(users)
    .limit(1000);

  const user = rows.find((row) => row.id === userId);
  return user?.isAdmin ?? false;
};

export const createSetupRouter = (deps: SetupRouterDeps): Hono<SetupAppContext> => {
  const router = new Hono<SetupAppContext>();

  router.get('/setup/status', async (c) => {
    const hasUsers = await checkHasUsers(deps);
    const { isSetupComplete } = await readConfiguredDomain(deps);

    return c.json({ hasUsers, isSetupComplete }, 200);
  });

  router.get('/setup/admin-status', authMiddleware, async (c) => {
    const userId = c.get('userId');
    const isAdmin = await lookupUserIsAdmin(deps, userId);

    return c.json({ isAdmin }, 200);
  });

  router.post('/setup/domain', async (c) => {
    const hasUsers = await checkHasUsers(deps);
    const guardResponse = await enforceAdminIfUsersExist(c, hasUsers);

    if (guardResponse) {
      return guardResponse;
    }

    const parsed = await parseJsonBody(c, setDomainSchema);
    if (!parsed.success) {
      return parsed.response;
    }

    await deps.configSvc.setConfig('domain', parsed.data.domain);

    return c.json({ success: true, domain: parsed.data.domain }, 200);
  });

  router.get('/setup/domain', async (c) => {
    const { domain } = await readConfiguredDomain(deps);
    return c.json({ domain }, 200);
  });

  router.get('/setup/dns-records', async (c) => {
    const { domain } = await readConfiguredDomain(deps);

    if (!domain) {
      return c.json({ error: 'DOMAIN_NOT_CONFIGURED' }, 400);
    }

    return c.json(generateDnsRecords(domain), 200);
  });

  router.post('/setup/dns-check', async (c) => {
    const { domain } = await readConfiguredDomain(deps);

    if (!domain) {
      return c.json({ error: 'DOMAIN_NOT_CONFIGURED' }, 400);
    }

    const result = await deps.dnsCheckSvc.checkDns(domain);
    return c.json(result, 200);
  });

  router.post('/setup/tls-trigger', async (c) => {
    const hasUsers = await checkHasUsers(deps);
    const guardResponse = await enforceAdminIfUsersExist(c, hasUsers);

    if (guardResponse) {
      return guardResponse;
    }

    const { domain } = await readConfiguredDomain(deps);

    if (!domain) {
      return c.json({ error: 'DOMAIN_NOT_CONFIGURED' }, 400);
    }

    const result = await deps.tlsSvc.triggerCertbot(domain);
    return c.json(result, 200);
  });

  router.get('/setup/tls-status', async (c) => {
    const { domain } = await readConfiguredDomain(deps);

    if (!domain) {
      return c.json({ hasCertificate: false, domain: '' }, 200);
    }

    const result = await deps.tlsSvc.getCertificateStatus(domain);
    return c.json(result, 200);
  });

  router.get('/setup/registration', async (c) => {
    const rawEnabled = await deps.configSvc.getConfig('registration_enabled');
    const enabled = typeof rawEnabled === 'boolean' ? rawEnabled : true;

    return c.json({ enabled }, 200);
  });

  router.put('/setup/registration', authMiddleware, requireAdmin, async (c) => {
    const parsed = await parseJsonBody(c, setRegistrationSchema);
    if (!parsed.success) {
      return parsed.response;
    }

    await deps.configSvc.setConfig('registration_enabled', parsed.data.enabled);
    return c.json({ success: true, enabled: parsed.data.enabled }, 200);
  });

  return router;
};

export const setupRouter = createSetupRouter({
  dbClient: db,
  configSvc: configService,
  dnsCheckSvc: dnsCheckService,
  tlsSvc: tlsService,
});
