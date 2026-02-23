import type { ImapCommand } from './types.js';

function tokenizeArguments(input: string): string[] | null {
  const args: string[] = [];
  let current = '';
  let inQuotes = false;
  let escaping = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === undefined) {
      continue;
    }

    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === '\\' && inQuotes) {
      escaping = true;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && /\s/.test(char)) {
      if (current.length > 0) {
        args.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (escaping || inQuotes) {
    return null;
  }

  if (current.length > 0) {
    args.push(current);
  }

  return args;
}

export function parseImapCommand(line: string): ImapCommand | null {
  const normalized = line.replace(/\r?\n$/, '').trim();
  if (!normalized) {
    return null;
  }

  const firstSpace = normalized.indexOf(' ');
  if (firstSpace <= 0) {
    return null;
  }

  const tag = normalized.slice(0, firstSpace);
  if (!/^[^\s]+$/.test(tag)) {
    return null;
  }

  const remainder = normalized.slice(firstSpace + 1).trim();
  if (!remainder) {
    return null;
  }

  const commandSpace = remainder.indexOf(' ');
  const command =
    commandSpace === -1 ? remainder.toUpperCase() : remainder.slice(0, commandSpace).toUpperCase();
  const argsInput = commandSpace === -1 ? '' : remainder.slice(commandSpace + 1).trim();

  const args = argsInput ? tokenizeArguments(argsInput) : [];
  if (args === null) {
    return null;
  }

  return {
    tag,
    command,
    args,
    raw: normalized,
  };
}
