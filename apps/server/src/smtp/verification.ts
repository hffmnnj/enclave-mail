import { resolveTxt } from 'node:dns/promises';

import { type DNSResolver, authenticate } from 'mailauth';

export type VerificationResult = {
  dkim: 'pass' | 'fail' | 'none';
  spf: 'pass' | 'fail' | 'none' | 'neutral';
  dmarc: 'pass' | 'fail' | 'none';
  dmarcPolicy: string | null;
};

type MockDnsRecords = Record<string, string | string[] | string[][]>;

function normalizeRawEmail(rawEmail: string): string {
  return rawEmail.replace(/\r?\n/g, '\r\n');
}

function extractHeaderValue(rawEmail: string, headerName: string): string | null {
  const headerPattern = new RegExp(`^${headerName}:\\s*(.+)$`, 'im');
  const match = rawEmail.match(headerPattern);
  return match?.[1]?.trim() ?? null;
}

function extractAddress(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const angleMatch = value.match(/<([^>]+)>/);
  const candidate = angleMatch?.[1] ?? value;
  const normalized = candidate.trim().toLowerCase();
  return normalized.includes('@') ? normalized : null;
}

function getEnvelopeSender(rawEmail: string): string {
  const returnPath = extractAddress(extractHeaderValue(rawEmail, 'Return-Path'));
  if (returnPath) {
    return returnPath;
  }

  const from = extractAddress(extractHeaderValue(rawEmail, 'From'));
  if (from) {
    return from;
  }

  return `postmaster@${process.env.SMTP_DOMAIN ?? 'localhost'}`;
}

function getHeloDomain(sender: string): string {
  const atIndex = sender.lastIndexOf('@');
  if (atIndex === -1 || atIndex === sender.length - 1) {
    return process.env.SMTP_DOMAIN ?? 'localhost';
  }

  return sender.slice(atIndex + 1);
}

function parseMockDnsRecords(): MockDnsRecords | null {
  const raw = process.env.MAILAUTH_DNS_RECORDS_JSON;
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }

    return parsed as MockDnsRecords;
  } catch {
    return null;
  }
}

function normalizeTxtRows(value: string | string[] | string[][]): string[][] {
  if (typeof value === 'string') {
    return [[value]];
  }

  if (value.length === 0) {
    return [];
  }

  const first = value[0];
  if (Array.isArray(first)) {
    return value as string[][];
  }

  return [value as string[]];
}

function getResolver(): DNSResolver {
  const mockRecords = parseMockDnsRecords();

  return async (domain: string, rrtype: string): Promise<string[][] | string[]> => {
    if (rrtype.toUpperCase() === 'TXT' && mockRecords) {
      const normalizedDomain = domain.toLowerCase();
      const configured =
        mockRecords[normalizedDomain] ?? mockRecords[domain] ?? mockRecords[`${domain}.`];

      if (configured) {
        return normalizeTxtRows(configured);
      }
    }

    if (rrtype.toUpperCase() === 'TXT') {
      return resolveTxt(domain);
    }

    return [];
  };
}

function toDkimStatus(result: string | undefined): VerificationResult['dkim'] {
  if (result === 'pass') {
    return 'pass';
  }

  if (result === 'none') {
    return 'none';
  }

  return 'fail';
}

function toSpfStatus(result: string | undefined): VerificationResult['spf'] {
  if (result === 'pass') {
    return 'pass';
  }

  if (result === 'none') {
    return 'none';
  }

  if (result === 'neutral') {
    return 'neutral';
  }

  return 'fail';
}

function toDmarcStatus(result: string | undefined): VerificationResult['dmarc'] {
  if (result === 'pass') {
    return 'pass';
  }

  if (result === 'none') {
    return 'none';
  }

  return 'fail';
}

export async function verifyMessage(
  rawEmail: string,
  sourceIp: string,
): Promise<VerificationResult> {
  const normalizedEmail = normalizeRawEmail(rawEmail);
  const sender = getEnvelopeSender(normalizedEmail);
  const helo = getHeloDomain(sender);

  const authResult = await authenticate(normalizedEmail, {
    ip: sourceIp,
    helo,
    sender,
    resolver: getResolver(),
  });

  const dkimTopResult = authResult.dkim.results[0]?.status?.result;
  const spfResult = authResult.spf ? authResult.spf.status.result : undefined;
  const dmarcResult = authResult.dmarc ? authResult.dmarc.status.result : undefined;

  return {
    dkim: toDkimStatus(dkimTopResult),
    spf: toSpfStatus(spfResult),
    dmarc: toDmarcStatus(dmarcResult),
    dmarcPolicy: authResult.dmarc ? authResult.dmarc.policy : null,
  };
}
