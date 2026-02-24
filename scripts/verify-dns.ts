#!/usr/bin/env bun
/**
 * DNS Verification Script for Enclave Mail
 *
 * Checks that all required DNS records are configured correctly for a
 * self-hosted Enclave Mail deployment: MX, A (mail subdomain), SPF, DKIM,
 * and DMARC.
 *
 * Usage:
 *   bun run scripts/verify-dns.ts <domain> <server-ip>
 *
 * Example:
 *   bun run scripts/verify-dns.ts example.com 1.2.3.4
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function dig(type: string, name: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`dig +short ${type} ${name}`);
    return stdout.trim();
  } catch {
    return '';
  }
}

function truncate(s: string, max = 80): string {
  return s.length > max ? `${s.substring(0, max)}…` : s;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

interface CheckResult {
  check: string;
  status: '✅' | '❌' | '⚠️';
  detail: string;
}

async function checkMx(domain: string): Promise<CheckResult> {
  const output = await dig('MX', domain);
  const hasMail = output.toLowerCase().includes('mail.');
  return {
    check: 'MX record',
    status: hasMail ? '✅' : '❌',
    detail: output || 'Not found — add: MX @ mail.your-domain.com priority 10',
  };
}

async function checkMailA(domain: string, serverIp: string): Promise<CheckResult> {
  const output = await dig('A', `mail.${domain}`);
  let status: CheckResult['status'];
  let detail: string;

  if (!output) {
    status = '❌';
    detail = `Not found — add: A mail ${serverIp}`;
  } else if (output === serverIp) {
    status = '✅';
    detail = output;
  } else {
    status = '⚠️';
    detail = `${output} (expected ${serverIp})`;
  }

  return { check: `A record (mail.${domain})`, status, detail };
}

async function checkSpf(domain: string, serverIp: string): Promise<CheckResult> {
  const output = await dig('TXT', domain);
  const spfLine = output.split('\n').find((r) => r.includes('v=spf1'));

  if (!spfLine) {
    return {
      check: 'SPF record',
      status: '❌',
      detail: `Not found — add: TXT @ "v=spf1 ip4:${serverIp} -all"`,
    };
  }

  const hasIp = spfLine.includes(serverIp);
  return {
    check: 'SPF record',
    status: hasIp ? '✅' : '⚠️',
    detail: hasIp ? truncate(spfLine) : `${truncate(spfLine)} (server IP ${serverIp} not listed)`,
  };
}

async function checkDkim(domain: string): Promise<CheckResult> {
  const output = await dig('TXT', `mail._domainkey.${domain}`);
  const hasDkim = output.includes('v=DKIM1');
  return {
    check: 'DKIM record (mail._domainkey)',
    status: hasDkim ? '✅' : '❌',
    detail: hasDkim
      ? truncate(output)
      : 'Not found — run scripts/generate-dkim-keys.ts and add the TXT record',
  };
}

async function checkDmarc(domain: string): Promise<CheckResult> {
  const output = await dig('TXT', `_dmarc.${domain}`);
  const hasDmarc = output.includes('v=DMARC1');
  return {
    check: 'DMARC record',
    status: hasDmarc ? '✅' : '❌',
    detail: hasDmarc
      ? truncate(output)
      : `Not found — add: TXT _dmarc "v=DMARC1; p=quarantine; rua=mailto:admin@${domain}"`,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function verifyDns(domain: string, serverIp: string): Promise<void> {
  console.log(`\n🔍 Verifying DNS for ${domain} (server: ${serverIp})\n`);

  const results: CheckResult[] = await Promise.all([
    checkMx(domain),
    checkMailA(domain, serverIp),
    checkSpf(domain, serverIp),
    checkDkim(domain),
    checkDmarc(domain),
  ]);

  for (const r of results) {
    console.log(`${r.status}  ${r.check}`);
    console.log(`    ${r.detail}\n`);
  }

  const passed = results.filter((r) => r.status === '✅').length;
  const warned = results.filter((r) => r.status === '⚠️').length;
  const failed = results.filter((r) => r.status === '❌').length;

  const warnSuffix = warned > 0 ? ` · ${warned} warning(s)` : '';
  console.log(`📊 Results: ${passed}/${results.length} passed${warnSuffix}`);

  if (failed > 0 || warned > 0) {
    console.log('\n💡 Resources:');
    console.log(`   MXToolbox:   https://mxtoolbox.com/SuperTool.aspx?action=mx%3a${domain}`);
    console.log('   mail-tester: https://www.mail-tester.com');
    console.log(`   DMARC check: https://dmarcian.com/dmarc-inspector/?domain=${domain}`);
  }

  if (failed > 0) {
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const [domain, serverIp] = process.argv.slice(2);

if (!domain || !serverIp) {
  console.error('Usage: bun run scripts/verify-dns.ts <domain> <server-ip>');
  console.error('Example: bun run scripts/verify-dns.ts example.com 1.2.3.4');
  process.exit(1);
}

verifyDns(domain, serverIp).catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
