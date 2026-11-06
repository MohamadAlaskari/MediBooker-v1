import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const SCRIPT = fileURLToPath(new URL('./medibooker.ts', import.meta.url));

/** An empty PATH: whatever these tests do, this program can never reach the real Docker. */
const NO_DOCKER_PATH = mkdtempSync(path.join(tmpdir(), 'medibooker-no-docker-'));
const ENV_WITHOUT_PATH = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'),
);

/** The real program. --dry-run only prints the commands. */
function run(args: readonly string[], input = '') {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    input,
    encoding: 'utf8',
    env: { ...ENV_WITHOUT_PATH, PATH: NO_DOCKER_PATH, NO_COLOR: '1' },
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

describe('medibooker', () => {
  it('explains itself', () => {
    const { code, out } = run(['--help']);
    expect(code).toBe(0);
    expect(out).toContain('--dry-run');
  });

  it('first asks for the mode, then shows the list', () => {
    const { code, out } = run(['--dry-run'], '1\nq\n');
    expect(code).toBe(0);
    expect(out.indexOf('welcher Betrieb?')).toBeLessThan(out.indexOf('MediBooker dev'));
    expect(out).toContain('Images bauen');
    expect(out).toContain('Health prüfen');
    expect(out).toContain('Cache des Projekts leeren');
  });

  it('goes back to the first question and on to the other mode', () => {
    const { code, out } = run(['--dry-run'], '1\nb\n2\nq\n');
    expect(code).toBe(0);
    expect(out).toContain('MediBooker dev');
    expect(out).toContain('MediBooker prod');
  });

  it('asks again after a wrong answer', () => {
    const { out } = run(['--dry-run'], '7\n1\n99\nq\n');
    expect(out).toContain('Bitte 1 oder 2.');
    expect(out).toContain('Bitte eine Nummer aus der Liste.');
  });

  it('ends when the input ends', () => {
    expect(run(['--dry-run'], '').code).toBe(0);
    expect(run(['--dry-run'], '1\n').code).toBe(0);
  });

  it('runs an entry from the menu by its number', () => {
    const { out } = run(['--dry-run'], '2\n1\nq\n');
    expect(out).toContain('docker compose --env-file .env.prod -f compose.prod.yaml build');
  });

  it('starts directly and prints the links after the commands', () => {
    const { code, out } = run(['dev', 'up', '--dry-run']);
    expect(code).toBe(0);
    expect(out.indexOf('up -d --wait')).toBeLessThan(
      out.indexOf('http://localhost:3000/ar/al-noor'),
    );
    expect(out).toContain('http://localhost:3001/api/docs');
    expect(out).toContain('GET http://localhost:3001/health/ready');
  });

  it('shows the links of production', () => {
    const { code, out } = run(['prod', 'links', '--dry-run']);
    expect(code).toBe(0);
    expect(out).toContain('http://localhost:8080/ar/al-noor');
    expect(out).toContain('http://localhost:8081/health/ready');
  });

  it('passes a service to the logs', () => {
    const { out } = run(['dev', 'logs', 'api', '--dry-run']);
    expect(out).toContain('logs -f --tail 100 api');
  });

  it('opens a shell in the first service without a question', () => {
    const { out } = run(['prod', 'shell', '--dry-run']);
    expect(out).toContain('exec proxy sh');
  });

  it('asks for the service in the menu, Enter takes all', () => {
    const logs = run(['--dry-run'], '1\nlogs\n\nq\n');
    expect(logs.out).toContain('Dienst [api, web, db, migrate, seed; Enter = alle]');
    expect(logs.out).toMatch(/logs -f --tail 100\n/);
    const chosen = run(['--dry-run'], '1\nlogs\nweb\nq\n');
    expect(chosen.out).toContain('logs -f --tail 100 web');
    const shell = run(['--dry-run'], '1\nshell\n\nq\n');
    expect(shell.out).toContain('exec api sh');
  });

  it('stops before anything else when Docker cannot be reached', () => {
    const { code, err } = run(['prod', 'purge', '--yes']);
    expect(code).toBe(1);
    expect(err).toContain('Docker läuft nicht');
  });

  it('needs no Docker for the links', () => {
    expect(run(['dev', 'links']).code).toBe(0);
  });

  it.each([['--dryrun'], ['--force'], ['-y']])('rejects the unknown option %s', (option) => {
    const { code, err } = run(['prod', 'purge', '--yes', option]);
    expect(code).toBe(2);
    expect(err).toContain(`Unbekannte Option: ${option}`);
  });

  it('refuses what deletes without --yes in a direct call', () => {
    const { code, out, err } = run(['prod', 'purge']);
    expect(code).toBe(1);
    expect(err).toContain('--yes');
    expect(out).toContain('Abgebrochen.');
  });

  it('asks for "ja" before deleting in the menu, and any other answer deletes nothing', () => {
    // Not a dry run, which skips the question: "nein" ends it before any command runs.
    const { out } = run([], '2\npurge\nnein\nq\n');
    expect(out).toContain('alle Daten des Betriebs prod werden gelöscht');
    expect(out).toContain('Zum Bestätigen "ja" eingeben');
    expect(out).toContain('Abgebrochen.');
  });

  it.each([[['nonsense', 'up']], [['dev']], [['dev', 'nonsense', '--dry-run']]])(
    'rejects %j',
    (args) => {
      expect(run(args).code).toBe(2);
    },
  );

  it('prints only paths inside the repository when cleaning in a dry run', () => {
    const { code, out } = run(['dev', 'clean-caches', '--dry-run']);
    expect(code).toBe(0);
    expect(out).not.toContain('..');
    expect(out).toMatch(/\d+ Ordner gelöscht\./);
  });
});

describe('the launchers', () => {
  const root = new URL('../', import.meta.url);

  it('medibooker.cmd has CRLF line endings, or cmd.exe misreads its labels', () => {
    const text = readFileSync(new URL('medibooker.cmd', root), 'utf8');
    expect(text).toContain('\r\n');
    expect(text.replaceAll('\r\n', '')).not.toContain('\n');
    expect(text).toContain('node scripts\\medibooker.ts %*');
  });

  it('medibooker.sh has LF line endings and passes its arguments on', () => {
    const text = readFileSync(new URL('medibooker.sh', root), 'utf8');
    expect(text.startsWith('#!/bin/sh\n')).toBe(true);
    expect(text).not.toContain('\r');
    expect(text).toContain('exec node scripts/medibooker.ts "$@"');
  });
});

describe('the compose files', () => {
  const root = new URL('../', import.meta.url);
  const dev = readFileSync(new URL('compose.dev.yaml', root), 'utf8');
  const prod = readFileSync(new URL('compose.prod.yaml', root), 'utf8');

  /** The ports as compose reads them, whatever their syntax; a long form fails the guard. */
  function portsOf(text: string): readonly unknown[] {
    const file = parse(text, { merge: true, logLevel: 'silent' }) as {
      services: Record<string, { ports?: readonly unknown[] }>;
    };
    return Object.values(file.services).flatMap(({ ports }) => ports ?? []);
  }

  it('keep every published port on this machine', () => {
    const published = [dev, prod].flatMap(portsOf);
    expect(published.length).toBeGreaterThan(0);
    expect(published.filter((port) => !/^127\.0\.0\.1:\d+:\d+$/.test(String(port)))).toEqual([]);
  });

  it('have their own project names, so they share no container and no data', () => {
    expect(dev).toMatch(/^name: medibooker-dev$/m);
    expect(prod).toMatch(/^name: medibooker-prod$/m);
  });

  it('publish different ports, so both can run at once', () => {
    const hostPort = (port: unknown): string => String(port).split(':')[1] ?? '';
    const devPorts = portsOf(dev).map(hostPort);
    expect(
      portsOf(prod)
        .map(hostPort)
        .filter((port) => devPorts.includes(port)),
    ).toEqual([]);
  });

  it('never publish the database of the production stack', () => {
    expect(prod).toMatch(/service: db\n\s+ports: !reset \[\]/);
  });

  it('keep the database off the network of the proxy and the web app', () => {
    const file = parse(prod, { merge: true, logLevel: 'silent' }) as {
      services: Record<string, { networks?: readonly string[] }>;
      networks: { data: { internal?: boolean } };
    };
    expect(file.networks.data.internal).toBe(true);
    expect(file.services.db?.networks).toEqual(['data']);
    expect(file.services.web?.networks).toEqual(['edge']);
    expect(file.services.proxy?.networks).toEqual(['edge']);
    expect(file.services.api?.networks).toEqual(['edge', 'data']);
  });

  it('run the production services read-only and without capabilities', () => {
    expect(prod).toContain('read_only: true');
    expect(prod).toContain('cap_drop: [ALL]');
    for (const service of ['migrate', 'api', 'web', 'proxy']) {
      expect(prod).toMatch(new RegExp(`^  ${service}:\\n    <<: \\*hardening`, 'm'));
    }
  });

  it('use no placeholder password of their own', () => {
    for (const text of [dev, prod]) expect(text).not.toMatch(/changeme/);
  });
});
