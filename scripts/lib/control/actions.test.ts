import { describe, expect, it } from 'vitest';
import { actionsOf, composeArguments, type Action, type Step } from './actions.ts';
import { STACKS, type Mode } from './stacks.ts';

function action(mode: Mode, id: string): Action {
  const found = actionsOf(STACKS[mode]).find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`No action ${id} in ${mode}`);
  return found;
}

function composeCommands(mode: Mode, id: string): readonly string[] {
  return action(mode, id)
    .steps.filter((step): step is Extract<Step, { kind: 'compose' }> => step.kind === 'compose')
    .map((step) => composeArguments(STACKS[mode], step).join(' '));
}

describe('the menus', () => {
  it.each(['dev', 'prod'] as const)('%s has unique ids and every promised entry', (mode) => {
    const ids = actionsOf(STACKS[mode]).map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining([
        'build',
        'up',
        'stop',
        'restart',
        'links',
        'status',
        'health',
        'logs',
        'shell',
        'migrate',
        'seed',
        'psql',
        'reset-db',
        'smoke',
        'down',
        'purge',
        'clean-caches',
        'clean-docker-cache',
        'clean-node-modules',
      ]),
    );
  });

  it('offers live reload and the test containers only in development', () => {
    const dev = actionsOf(STACKS.dev).map(({ id }) => id);
    const prod = actionsOf(STACKS.prod).map(({ id }) => id);
    expect(dev).toEqual(expect.arrayContaining(['start', 'check', 'integration', 'e2e']));
    for (const id of ['start', 'check', 'integration', 'e2e']) expect(prod).not.toContain(id);
    expect(prod.join(' ')).not.toContain('watch');
  });

  it.each(['dev', 'prod'] as const)('%s asks before everything that deletes data', (mode) => {
    const confirmed = actionsOf(STACKS[mode])
      .filter(({ confirm }) => confirm !== undefined)
      .map(({ id }) => id);
    expect(confirmed).toEqual(['reset-db', 'purge', 'clean-docker-cache', 'clean-node-modules']);
  });

  it('never deletes a volume without asking', () => {
    const unconfirmed = (['dev', 'prod'] as const).flatMap((mode) =>
      actionsOf(STACKS[mode])
        .filter(({ confirm, steps }) => {
          const deletes = steps.some((step) => step.kind === 'compose' && step.args.includes('-v'));
          return deletes && confirm === undefined;
        })
        .map(({ id }) => id),
    );
    expect(unconfirmed).toEqual([]);
  });
});

describe('the commands', () => {
  it('start development: one build, then the containers with its profile', () => {
    expect(composeCommands('dev', 'up')).toEqual([
      'compose --env-file .env -f compose.dev.yaml --profile app build api',
      'compose --env-file .env -f compose.dev.yaml --profile app up -d --wait --wait-timeout 300 --no-build',
    ]);
  });

  it('start production: what was built, in its own project and environment file', () => {
    expect(composeCommands('prod', 'up')).toEqual([
      'compose --env-file .env.prod -f compose.prod.yaml up -d --wait --wait-timeout 300',
    ]);
  });

  it('show the links and the health after a start', () => {
    for (const mode of ['dev', 'prod'] as const) {
      const kinds = action(mode, 'up').steps.map(({ kind }) => kind);
      expect(kinds.slice(-2)).toEqual(['links', 'health']);
    }
  });

  it('start with live reload ends in the watcher', () => {
    const { steps } = action('dev', 'start');
    expect(steps.at(-1)).toMatchObject({ kind: 'compose', args: ['watch', '--no-up'] });
  });

  it('build the test image first: the containers hold a copy of the sources', () => {
    expect(composeCommands('dev', 'check')).toEqual([
      'compose --env-file .env -f compose.dev.yaml --profile tools build tools',
      'compose --env-file .env -f compose.dev.yaml --profile tools run --rm --no-deps tools',
    ]);
  });

  it('seed production through its own profile', () => {
    expect(composeCommands('prod', 'seed')).toEqual([
      'compose --env-file .env.prod -f compose.prod.yaml --profile demo run --rm seed',
    ]);
  });

  it('remove every profile with all of its images when asked to purge', () => {
    expect(composeCommands('prod', 'purge')).toEqual([
      'compose --env-file .env.prod -f compose.prod.yaml --profile * down -v --rmi all --remove-orphans',
    ]);
  });

  it('restart only the services that keep running', () => {
    expect(composeCommands('dev', 'restart')[0]).toMatch(/restart api web$/);
    expect(composeCommands('prod', 'restart')[0]).toMatch(/restart api web proxy$/);
  });
});

describe('composeArguments', () => {
  const stack = STACKS.dev;

  it('appends a chosen service', () => {
    const step: Step = { kind: 'compose', args: ['logs', '-f'], service: 'optional' };
    expect(composeArguments(stack, step, 'api').slice(-3)).toEqual(['logs', '-f', 'api']);
    expect(composeArguments(stack, step).slice(-2)).toEqual(['logs', '-f']);
  });

  it('opens a shell in the chosen service', () => {
    const step: Step = { kind: 'compose', args: ['exec'], service: 'required' };
    expect(composeArguments(stack, step, 'web').slice(-3)).toEqual(['exec', 'web', 'sh']);
  });
});
