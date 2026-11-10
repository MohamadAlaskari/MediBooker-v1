import { describe, expect, it } from 'vitest';
import { actionsOf } from './actions.ts';
import { linksOf, STACKS } from './stacks.ts';
import {
  actionOfAnswer,
  modeOfAnswer,
  modeQuestion,
  renderChecks,
  renderLinks,
  renderMenu,
  statusLineOf,
  styleOf,
} from './view.ts';

describe('the first question', () => {
  it('offers dev as 1 and prod as 2', () => {
    const text = modeQuestion();
    expect(text).toMatch(/1\) dev/);
    expect(text).toMatch(/2\) prod/);
  });

  it.each([
    ['1', 'dev'],
    ['2', 'prod'],
    ['dev', 'dev'],
    [' PROD ', 'prod'],
  ])('reads %j as %s', (answer, mode) => {
    expect(modeOfAnswer(answer)).toBe(mode);
  });

  it.each(['', '3', 'staging'])('does not read %j as a mode', (answer) => {
    expect(modeOfAnswer(answer)).toBeUndefined();
  });
});

describe('the menu', () => {
  const actions = actionsOf(STACKS.dev);

  it('numbers every entry from 1 under its group', () => {
    const text = renderMenu(STACKS.dev, actions, 'Status');
    expect(text).toContain('MediBooker dev');
    expect(text).toContain('Status');
    actions.forEach(({ label }, index) => {
      expect(text).toContain(`${String(index + 1).padStart(2)}) ${label}`);
    });
    for (const group of new Set(actions.map((action) => action.group))) {
      expect(text).toContain(group);
    }
    expect(text).toContain('b) Betrieb wechseln');
    expect(text).toContain('q) Beenden');
  });

  it('finds an action by number and by id', () => {
    expect(actionOfAnswer(actions, '1')?.id).toBe('build');
    expect(actionOfAnswer(actions, ' logs ')?.id).toBe('logs');
  });

  it.each(['0', '99', 'nonsense', ''])('finds no action for %j', (answer) => {
    expect(actionOfAnswer(actions, answer)).toBeUndefined();
  });
});

describe('the links', () => {
  it('development shows web, backend, Swagger and health', () => {
    const text = renderLinks(STACKS.dev, linksOf(STACKS.dev, true));
    for (const url of [
      'http://localhost:3000/ar',
      'http://localhost:3000/en',
      'http://localhost:3001/api/v1/public/practices/al-noor',
      'http://localhost:3001/api/docs',
      'http://localhost:3001/health/live',
      'http://localhost:3001/health/ready',
      'http://localhost:3000/healthz',
      'http://localhost:8025',
    ]) {
      expect(text).toContain(url);
    }
  });

  it('production goes through the proxy and says when Swagger is off', () => {
    const text = renderLinks(STACKS.prod, linksOf(STACKS.prod, false));
    expect(text).toContain('http://localhost:8080/en');
    expect(text).toContain('http://localhost:8080/api/v1/public/practices/al-noor');
    expect(text).toContain('http://localhost:8081/health/ready');
    expect(text).toContain('OPENAPI_UI_ENABLED=true');
    expect(text).not.toContain('/api/docs');
  });

  it('says where the e-mails go when a real mail server takes them', () => {
    const text = renderLinks(STACKS.dev, linksOf(STACKS.dev, true, 'smtp.example.test'));
    expect(text).toContain('echt über smtp.example.test');
    expect(text).not.toContain('http://localhost:8025');
  });

  it('says where the files go: Azurite, an account by its name, or nowhere yet', () => {
    expect(renderLinks(STACKS.dev, linksOf(STACKS.dev, true))).toContain(
      'http://localhost:10000/devstoreaccount1',
    );
    expect(renderLinks(STACKS.prod, linksOf(STACKS.prod, false))).toContain(
      'kein Speicher eingetragen',
    );
    expect(
      renderLinks(STACKS.prod, linksOf(STACKS.prod, false, undefined, 'medibookerfiles')),
    ).toContain('Azure-Konto medibookerfiles');
  });

  it('production shows the Swagger link once it is on', () => {
    expect(renderLinks(STACKS.prod, linksOf(STACKS.prod, true))).toContain(
      'http://localhost:8081/api/docs',
    );
  });
});

describe('the check results', () => {
  const base = { ok: false, hint: undefined, advisory: false };
  const passed = { ...base, name: 'A', url: 'http://a', ok: true, problem: '' };

  it('summarises when all pass', () => {
    expect(renderChecks('Health', [passed])).toContain('Alle 1 in Ordnung.');
  });

  it('names the failed check, its URL and what to do', () => {
    const text = renderChecks('Health', [
      passed,
      { ...base, name: 'B', url: 'http://b', problem: 'Status 500', hint: 'Do this' },
      { ...base, name: 'C', url: 'http://c', problem: 'Status 404' },
    ]);
    expect(text).toContain('B: Status 500: Do this');
    expect(text).toContain('http://b');
    expect(text).toContain('C: Status 404\n');
    expect(text).toContain('2 von 3 fehlgeschlagen.');
  });
});

describe('an advisory result', () => {
  it('is a hint with what to do, not a failure', () => {
    const text = renderChecks('Health', [
      { name: 'A', url: 'http://a', ok: true, problem: '', hint: undefined, advisory: false },
      {
        name: 'B',
        url: 'http://b',
        ok: false,
        problem: 'Status 404',
        hint: 'Do this',
        advisory: true,
      },
    ]);
    expect(text).toContain('HINWEIS B: Status 404: Do this');
    expect(text).toContain('Keine Fehler.');
    expect(text).not.toContain('fehlgeschlagen');
  });
});

describe('the status line', () => {
  it.each(['', 'not json', '{}', '{"State":"exited","Service":"migrate"}'])(
    'says nothing runs for %j',
    (output) => {
      expect(statusLineOf(output)).toBe('Läuft gerade nicht.');
    },
  );

  it('lists running services sorted, with what is not healthy yet', () => {
    const lines = [
      { Service: 'web', State: 'running', Health: 'starting' },
      { Service: 'api', State: 'running', Health: 'healthy' },
      { Service: 'db', State: 'running', Health: 'unhealthy' },
      { Service: 'migrate', State: 'exited', Health: '' },
    ];
    expect(statusLineOf(lines.map((line) => JSON.stringify(line)).join('\n'))).toBe(
      'Läuft: api, db (unhealthy), web (starting)',
    );
  });

  it('reads the array of an older compose', () => {
    expect(statusLineOf(JSON.stringify([{ Service: 'api', State: 'running' }]))).toBe('Läuft: api');
  });

  it('survives an entry without a name', () => {
    expect(statusLineOf('{"State":"running"}')).toBe('Läuft: ?');
  });

  it('reads an output that is no list as nothing', () => {
    expect(statusLineOf('[')).toBe('Läuft gerade nicht.');
  });
});

describe('styleOf', () => {
  it('paints when enabled and stays plain otherwise', () => {
    expect(styleOf(true).green('x')).toBe('\u001b[32mx\u001b[0m');
    expect(styleOf(false).green('x')).toBe('x');
  });
});
