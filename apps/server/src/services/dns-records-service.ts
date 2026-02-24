export interface DnsRecord {
  type: 'MX' | 'TXT';
  host: string;
  value: string;
  priority?: number;
  label: string;
}

export interface DnsRecordsResult {
  mx: DnsRecord;
  spf: DnsRecord;
  dkim: DnsRecord;
  dmarc: DnsRecord;
}

export const generateDnsRecords = (domain: string): DnsRecordsResult => ({
  mx: {
    type: 'MX',
    host: '@',
    value: `mail.${domain}`,
    priority: 10,
    label: 'MX Record',
  },
  spf: {
    type: 'TXT',
    host: '@',
    value: 'v=spf1 mx ~all',
    label: 'SPF Record',
  },
  dkim: {
    type: 'TXT',
    host: 'mail._domainkey',
    value: 'v=DKIM1; k=rsa; p=<DKIM_PUBLIC_KEY_PLACEHOLDER>',
    label: 'DKIM Record',
  },
  dmarc: {
    type: 'TXT',
    host: '_dmarc',
    value: `v=DMARC1; p=none; rua=mailto:postmaster@${domain}`,
    label: 'DMARC Record',
  },
});
