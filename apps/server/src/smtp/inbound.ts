import type { ParsedMail } from 'mailparser';
import { simpleParser } from 'mailparser';

type ParsedMailWithRawSize = ParsedMail & {
  __rawSize?: number;
};

type ParsedAddress = {
  address?: string;
};

type ParsedAddressField = {
  text?: string;
  value: ParsedAddress[];
};

export type MailMetadata = {
  from: string;
  to: string[];
  subject: string;
  messageId: string;
  inReplyTo: string | null;
  date: Date;
  size: number;
};

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

function flattenAddressField(
  field: ParsedAddressField | ParsedAddressField[] | undefined,
): ParsedAddress[] {
  if (!field) {
    return [];
  }

  if (Array.isArray(field)) {
    return field.flatMap((entry: ParsedAddressField) => entry.value);
  }

  return field.value;
}

function extractFromAddress(parsed: ParsedMail): string {
  const primary = flattenAddressField(parsed.from as ParsedAddressField | ParsedAddressField[])[0]
    ?.address;
  if (primary) {
    return normalizeAddress(primary);
  }

  if (Array.isArray(parsed.from)) {
    return parsed.from[0]?.text?.trim() ?? '';
  }

  return parsed.from?.text?.trim() ?? '';
}

function extractToAddresses(parsed: ParsedMail): string[] {
  const toValues = flattenAddressField(parsed.to as ParsedAddressField | ParsedAddressField[]);
  return toValues
    .map((entry: ParsedAddress) => entry.address)
    .filter((address: string | undefined): address is string =>
      Boolean(address && address.trim().length > 0),
    )
    .map((address: string) => normalizeAddress(address));
}

export async function parseRawEmail(rawEmail: string): Promise<ParsedMail> {
  const parsed = await simpleParser(rawEmail);
  const parsedWithSize = parsed as ParsedMailWithRawSize;
  parsedWithSize.__rawSize = Buffer.byteLength(rawEmail, 'utf8');
  return parsed;
}

export function extractMailMetadata(parsed: ParsedMail): MailMetadata {
  const parsedWithSize = parsed as ParsedMailWithRawSize;

  return {
    from: extractFromAddress(parsed),
    to: extractToAddresses(parsed),
    subject: parsed.subject ?? '',
    messageId: parsed.messageId?.trim() ?? '',
    inReplyTo: parsed.inReplyTo?.trim() ?? null,
    date: parsed.date ?? new Date(),
    size: parsedWithSize.__rawSize ?? 0,
  };
}
