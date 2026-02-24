import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, mock, test } from 'bun:test';

import { startSMTPServer } from './server.js';

function parseIni(input: string): Map<string, Map<string, string>> {
  const sections = new Map<string, Map<string, string>>();
  let currentSection = 'main';
  sections.set(currentSection, new Map());

  for (const rawLine of input.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) {
      continue;
    }

    if (line.startsWith('[') && line.endsWith(']')) {
      currentSection = line.slice(1, -1).trim();
      if (!currentSection) {
        throw new Error('Invalid section header');
      }
      sections.set(currentSection, new Map());
      continue;
    }

    const equalsIndex = line.indexOf('=');
    if (equalsIndex === -1) {
      throw new Error(`Invalid INI line: ${line}`);
    }

    const key = line.slice(0, equalsIndex).trim();
    const value = line.slice(equalsIndex + 1).trim();
    if (!key) {
      throw new Error(`Invalid INI key: ${line}`);
    }

    const section = sections.get(currentSection);
    if (!section) {
      throw new Error(`Unknown section: ${currentSection}`);
    }
    section.set(key, value);
  }

  return sections;
}

describe('smtp server config', () => {
  test('smtp.ini parses and enforces single-process nodes=0', async () => {
    const smtpIniPath = resolve(import.meta.dir, '../../haraka/config/smtp.ini');
    const smtpIniRaw = await readFile(smtpIniPath, 'utf8');
    const ini = parseIni(smtpIniRaw);
    const main = ini.get('main');

    expect(main).toBeDefined();
    expect(main?.get('nodes')).toBe('0');
    // listen must declare at least two port bindings (inbound + submission)
    const listen = main?.get('listen') ?? '';
    const ports = listen.match(/:\d+/g) ?? [];
    expect(ports.length).toBeGreaterThanOrEqual(2);
  });

  test('tls.ini parses with key/cert entries', async () => {
    const tlsIniPath = resolve(import.meta.dir, '../../haraka/config/tls.ini');
    const tlsIniRaw = await readFile(tlsIniPath, 'utf8');
    const ini = parseIni(tlsIniRaw);
    const main = ini.get('main');

    expect(main).toBeDefined();
    expect(main?.get('key')).toBeTruthy();
    expect(main?.get('cert')).toBeTruthy();
  });

  test('plugins file includes enclave SMTP plugins', async () => {
    const pluginsPath = resolve(import.meta.dir, '../../haraka/config/plugins');
    const pluginsRaw = await readFile(pluginsPath, 'utf8');
    const plugins = pluginsRaw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    expect(plugins).toContain('auth.enclave_auth');
    expect(plugins).toContain('dkim.enclave_dkim');
    expect(plugins).toContain('queue.enclave_queue');
    expect(plugins).toContain('rcpt_to.enclave_rcpt');
  });
});

describe('startSMTPServer', () => {
  test('returns a subprocess handle in smoke mode', () => {
    const fakeHandle = {
      stdout: null,
      stderr: null,
      kill: mock(() => true),
    } as unknown as ReturnType<typeof Bun.spawn>;

    const spawnMock = mock(() => fakeHandle);

    const handle = startSMTPServer({
      cwd: resolve(import.meta.dir, '../..'),
      spawn: spawnMock as typeof Bun.spawn,
      logger: {
        info: () => undefined,
        error: () => undefined,
      },
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(handle).toBe(fakeHandle);
  });
});
