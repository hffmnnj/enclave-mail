import dns from 'node:dns';

export type DnsRecordStatus = 'pass' | 'fail' | 'not-found';

export interface DnsCheckResult {
  mx: DnsRecordStatus;
  spf: DnsRecordStatus;
  dkim: DnsRecordStatus;
  dmarc: DnsRecordStatus;
  allPassed: boolean;
}

type ResolveMxFn = (hostname: string) => Promise<dns.MxRecord[]>;
type ResolveTxtFn = (hostname: string) => Promise<string[][]>;

export interface DnsCheckServiceDeps {
  resolveMx?: ResolveMxFn;
  resolveTxt?: ResolveTxtFn;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;

const isDnsNotFoundError = (error: unknown): boolean => {
  if (error instanceof Error && 'code' in error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENODATA' || code === 'ENOTFOUND' || code === 'ESERVFAIL';
  }
  return false;
};

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error('DNS_TIMEOUT')), ms);
    }),
  ]);

const checkMx = async (
  domain: string,
  resolveMx: ResolveMxFn,
  timeoutMs: number,
): Promise<DnsRecordStatus> => {
  try {
    const records = await withTimeout(resolveMx(domain), timeoutMs);
    const expectedHost = `mail.${domain}`;
    const hasMatch = records.some(
      (record) => record.exchange === expectedHost || record.exchange === `${expectedHost}.`,
    );
    return hasMatch ? 'pass' : 'fail';
  } catch (error: unknown) {
    if (isDnsNotFoundError(error) || (error instanceof Error && error.message === 'DNS_TIMEOUT')) {
      return 'not-found';
    }
    return 'fail';
  }
};

const checkTxtRecord = async (
  hostname: string,
  marker: string,
  resolveTxt: ResolveTxtFn,
  timeoutMs: number,
): Promise<DnsRecordStatus> => {
  try {
    const records = await withTimeout(resolveTxt(hostname), timeoutMs);
    const flattened = records.map((chunks) => chunks.join(''));
    const hasMatch = flattened.some((txt) => txt.includes(marker));
    return hasMatch ? 'pass' : 'fail';
  } catch (error: unknown) {
    if (isDnsNotFoundError(error) || (error instanceof Error && error.message === 'DNS_TIMEOUT')) {
      return 'not-found';
    }
    return 'fail';
  }
};

export const createDnsCheckService = (deps?: DnsCheckServiceDeps) => {
  const resolveMx: ResolveMxFn = deps?.resolveMx ?? dns.promises.resolveMx;
  const resolveTxt: ResolveTxtFn = deps?.resolveTxt ?? dns.promises.resolveTxt;
  const timeoutMs = deps?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async checkDns(domain: string): Promise<DnsCheckResult> {
      const [mx, spf, dkim, dmarc] = await Promise.all([
        checkMx(domain, resolveMx, timeoutMs),
        checkTxtRecord(domain, 'v=spf1', resolveTxt, timeoutMs),
        checkTxtRecord(`mail._domainkey.${domain}`, 'v=DKIM1', resolveTxt, timeoutMs),
        checkTxtRecord(`_dmarc.${domain}`, 'v=DMARC1', resolveTxt, timeoutMs),
      ]);

      return {
        mx,
        spf,
        dkim,
        dmarc,
        allPassed: mx === 'pass' && spf === 'pass' && dkim === 'pass' && dmarc === 'pass',
      };
    },
  };
};

export const dnsCheckService = createDnsCheckService();
