import { Hono } from 'hono';

import { ipRateLimit } from '../../middleware/rate-limit.js';

type CspReportFields = {
  'violated-directive'?: unknown;
  'effective-directive'?: unknown;
  'blocked-uri'?: unknown;
  'document-uri'?: unknown;
};

type CspReportEnvelope = {
  'csp-report'?: unknown;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toStringOrUndefined = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const getClientIp = (req: Request): string => {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) {
      return first;
    }
  }

  return 'unknown';
};

const extractReport = (body: unknown): CspReportFields => {
  if (!isObject(body)) {
    return {};
  }

  const envelope = body as CspReportEnvelope;
  const nested = envelope['csp-report'];
  if (isObject(nested)) {
    return nested as CspReportFields;
  }

  return body as CspReportFields;
};

export const cspRouter = new Hono();

cspRouter.post('/csp-report', ipRateLimit, async (c) => {
  let payload: unknown;

  try {
    payload = await c.req.json();
  } catch {
    return c.body(null, 204);
  }

  const report = extractReport(payload);
  const violatedDirective =
    toStringOrUndefined(report['violated-directive']) ??
    toStringOrUndefined(report['effective-directive']) ??
    'unknown';
  const blockedUri = toStringOrUndefined(report['blocked-uri']) ?? 'unknown';
  const documentUri = toStringOrUndefined(report['document-uri']) ?? 'unknown';

  console.warn(
    '[csp-report] violation',
    JSON.stringify({
      timestamp: new Date().toISOString(),
      violatedDirective,
      blockedUri,
      documentUri,
      ip: getClientIp(c.req.raw),
      userAgent: c.req.header('user-agent') ?? 'unknown',
    }),
  );

  return c.body(null, 204);
});
