import { db, users } from '@enclave/db';
import { QUEUE_NAMES } from '@enclave/types';
import { Queue } from 'bullmq';
import { count, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AuthVariables } from '../../middleware/auth.js';
import { authMiddleware, requireAdmin } from '../../middleware/auth.js';
import { createRedisConnection } from '../../queue/connection.js';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const userIdParamSchema = z.object({
  id: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

interface AdminUserItem {
  id: string;
  email: string;
  emailVerified: boolean;
  isAdmin: boolean;
  disabled: boolean;
  createdAt: string;
}

interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

interface FailedJobItem {
  id: string;
  name: string;
  to: string[];
  from: string;
  failedReason: string;
  processedOn: string | null;
}

// ---------------------------------------------------------------------------
// Admin router
// ---------------------------------------------------------------------------

export const adminRouter = new Hono<{ Variables: AuthVariables }>();

// All admin routes require authentication + admin privileges
adminRouter.use('*', authMiddleware);
adminRouter.use('*', requireAdmin);

// ---------------------------------------------------------------------------
// GET /admin/users — paginated user list
// ---------------------------------------------------------------------------

adminRouter.get('/admin/users', async (c) => {
  const query = paginationSchema.parse(c.req.query());
  const offset = (query.page - 1) * query.limit;

  const [userRows, totalRows] = await Promise.all([
    db
      .select({
        id: users.id,
        email: users.email,
        emailVerified: users.emailVerified,
        isAdmin: users.isAdmin,
        disabled: users.disabled,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(users.createdAt)
      .limit(query.limit)
      .offset(offset),
    db.select({ count: count() }).from(users),
  ]);

  const total = totalRows[0]?.count ?? 0;

  const items: AdminUserItem[] = userRows.map((u) => ({
    id: u.id,
    email: u.email,
    emailVerified: u.emailVerified,
    isAdmin: u.isAdmin,
    disabled: u.disabled,
    createdAt: u.createdAt.toISOString(),
  }));

  return c.json({
    users: items,
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.ceil(total / query.limit),
  });
});

// ---------------------------------------------------------------------------
// POST /admin/users/:id/disable — disable a user account
// ---------------------------------------------------------------------------

adminRouter.post('/admin/users/:id/disable', async (c) => {
  const { id } = userIdParamSchema.parse(c.req.param());
  const adminUserId = c.get('userId');

  if (id === adminUserId) {
    return c.json({ error: 'Cannot disable your own account' }, 400);
  }

  const [updated] = await db
    .update(users)
    .set({ disabled: true, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning({ id: users.id });

  if (!updated) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json({ success: true, userId: updated.id });
});

// ---------------------------------------------------------------------------
// POST /admin/users/:id/enable — re-enable a user account
// ---------------------------------------------------------------------------

adminRouter.post('/admin/users/:id/enable', async (c) => {
  const { id } = userIdParamSchema.parse(c.req.param());

  const [updated] = await db
    .update(users)
    .set({ disabled: false, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning({ id: users.id });

  if (!updated) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json({ success: true, userId: updated.id });
});

// ---------------------------------------------------------------------------
// DELETE /admin/users/:id — delete a user account
// ---------------------------------------------------------------------------

adminRouter.delete('/admin/users/:id', async (c) => {
  const { id } = userIdParamSchema.parse(c.req.param());
  const adminUserId = c.get('userId');

  if (id === adminUserId) {
    return c.json({ error: 'Cannot delete your own account' }, 400);
  }

  const [deleted] = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id });

  if (!deleted) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json({ success: true, userId: deleted.id });
});

// ---------------------------------------------------------------------------
// POST /admin/users/:id/verify — manually verify a user's email
// ---------------------------------------------------------------------------

adminRouter.post('/admin/users/:id/verify', async (c) => {
  const { id } = userIdParamSchema.parse(c.req.param());

  const [updated] = await db
    .update(users)
    .set({
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationExpiry: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, id))
    .returning({ id: users.id });

  if (!updated) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json({ success: true, userId: updated.id });
});

// ---------------------------------------------------------------------------
// GET /admin/queue-stats — BullMQ queue job counts
// ---------------------------------------------------------------------------

adminRouter.get('/admin/queue-stats', async (c) => {
  const connection = createRedisConnection();

  try {
    const outbound = new Queue(QUEUE_NAMES.OUTBOUND_MAIL, { connection });
    const inbound = new Queue(QUEUE_NAMES.INBOUND_MAIL, { connection });
    const deadLetter = new Queue(QUEUE_NAMES.DEAD_LETTER, { connection });

    const [outboundCounts, inboundCounts, deadLetterCounts] = await Promise.all([
      outbound.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
      inbound.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
      deadLetter.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
    ]);

    await Promise.all([outbound.close(), inbound.close(), deadLetter.close()]);
    await connection.quit();

    const toStats = (counts: Record<string, number>): QueueStats => ({
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
      delayed: counts.delayed ?? 0,
    });

    return c.json({
      outbound: toStats(outboundCounts),
      inbound: toStats(inboundCounts),
      deadLetter: toStats(deadLetterCounts),
    });
  } catch (err) {
    await connection.quit().catch(() => {});
    throw err;
  }
});

// ---------------------------------------------------------------------------
// GET /admin/queue-stats/failed — list of failed jobs
// ---------------------------------------------------------------------------

adminRouter.get('/admin/queue-stats/failed', async (c) => {
  const connection = createRedisConnection();

  try {
    const outbound = new Queue(QUEUE_NAMES.OUTBOUND_MAIL, { connection });
    const failedJobs = await outbound.getFailed(0, 50);

    const items: FailedJobItem[] = failedJobs.map((job) => {
      const data = job.data as Record<string, unknown>;
      return {
        id: job.id ?? '',
        name: job.name,
        to: Array.isArray(data.to) ? (data.to as string[]) : [],
        from: typeof data.from === 'string' ? data.from : '',
        failedReason: job.failedReason ?? 'Unknown',
        processedOn: job.processedOn ? new Date(job.processedOn).toISOString() : null,
      };
    });

    await outbound.close();
    await connection.quit();

    return c.json({ failed: items, total: items.length });
  } catch (err) {
    await connection.quit().catch(() => {});
    throw err;
  }
});

// ---------------------------------------------------------------------------
// POST /admin/queue-stats/retry/:jobId — retry a failed job
// ---------------------------------------------------------------------------

adminRouter.post('/admin/queue-stats/retry/:jobId', async (c) => {
  const jobId = c.req.param('jobId');

  if (!jobId) {
    return c.json({ error: 'Job ID is required' }, 400);
  }

  const connection = createRedisConnection();

  try {
    const outbound = new Queue(QUEUE_NAMES.OUTBOUND_MAIL, { connection });
    const job = await outbound.getJob(jobId);

    if (!job) {
      await outbound.close();
      await connection.quit();
      return c.json({ error: 'Job not found' }, 404);
    }

    await job.retry();

    await outbound.close();
    await connection.quit();

    return c.json({ success: true, jobId });
  } catch (err) {
    await connection.quit().catch(() => {});
    throw err;
  }
});
