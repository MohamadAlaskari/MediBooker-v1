import type { Stack } from './stacks.ts';

/** What the control program does for one menu entry, in order. Plain data, so tests can read it. */
export type Step =
  | {
      readonly kind: 'compose';
      readonly args: readonly string[];
      /** Compose profiles of this step; `*` is all of them. */
      readonly profiles?: readonly string[];
      /** Appends a service the user chooses to the arguments. */
      readonly service?: 'optional' | 'required';
    }
  | { readonly kind: 'docker'; readonly args: readonly string[] }
  | {
      readonly kind: 'links' | 'health' | 'smoke' | 'clean-caches' | 'clean-node-modules';
    };

export interface Action {
  readonly id: string;
  readonly group: string;
  readonly label: string;
  /** Asked before a step that deletes something. */
  readonly confirm?: string;
  readonly steps: readonly Step[];
}

const GROUP_RUN = 'Aufbauen und ausführen';
const GROUP_WATCH = 'Überwachen';
const GROUP_DATABASE = 'Datenbank';
const GROUP_TESTS = 'Tests';
const GROUP_CLEAN = 'Aufräumen';

const WAIT_SECONDS = '300';
const ALL_PROFILES = ['*'] as const;

function profilesOf(stack: Stack): readonly string[] {
  return stack.appProfile === undefined ? [] : [stack.appProfile];
}

/**
 * Starts the stack. The development containers hold a copy of the sources, so a start builds first
 * and brings changes along; every service shares one image, so one build covers them. The
 * production stack runs what "build" last built and builds only an image that is missing.
 */
function upSteps(stack: Stack): readonly Step[] {
  const profiles = profilesOf(stack);
  const wait = ['up', '-d', '--wait', '--wait-timeout', WAIT_SECONDS];
  return stack.mode === 'dev'
    ? [
        { kind: 'compose', profiles, args: ['build', 'api'] },
        { kind: 'compose', profiles, args: [...wait, '--no-build'] },
      ]
    : [{ kind: 'compose', profiles, args: wait }];
}

function buildAction(stack: Stack): Action {
  return {
    id: 'build',
    group: GROUP_RUN,
    label: 'Images bauen',
    steps: [
      {
        kind: 'compose',
        profiles: profilesOf(stack),
        args: stack.mode === 'dev' ? ['build', 'api'] : ['build'],
      },
    ],
  };
}

function runActions(stack: Stack): readonly Action[] {
  const profiles = profilesOf(stack);
  const started: readonly Step[] = [...upSteps(stack), { kind: 'links' }, { kind: 'health' }];
  return [
    buildAction(stack),
    ...(stack.mode === 'dev'
      ? [
          {
            id: 'start',
            group: GROUP_RUN,
            label: 'Starten mit Live-Reload (Strg+C beendet nur das Beobachten)',
            steps: [
              ...started,
              { kind: 'compose', profiles, args: ['watch', '--no-up'] },
            ] satisfies readonly Step[],
          },
        ]
      : []),
    {
      id: 'up',
      group: GROUP_RUN,
      label: stack.mode === 'dev' ? 'Starten ohne Live-Reload' : 'Starten',
      steps: started,
    },
    {
      id: 'stop',
      group: GROUP_RUN,
      label: 'Stoppen',
      steps: [{ kind: 'compose', profiles, args: ['stop'] }],
    },
    {
      id: 'restart',
      group: GROUP_RUN,
      label: 'Neu starten',
      steps: [
        { kind: 'compose', profiles, args: ['restart', ...stack.runningServices] },
        { kind: 'links' },
      ],
    },
  ];
}

function watchActions(stack: Stack): readonly Action[] {
  const profiles = profilesOf(stack);
  return [
    { id: 'links', group: GROUP_WATCH, label: 'Links anzeigen', steps: [{ kind: 'links' }] },
    {
      id: 'status',
      group: GROUP_WATCH,
      label: 'Status der Container',
      steps: [{ kind: 'compose', profiles, args: ['ps', '-a'] }],
    },
    { id: 'health', group: GROUP_WATCH, label: 'Health prüfen', steps: [{ kind: 'health' }] },
    {
      id: 'logs',
      group: GROUP_WATCH,
      label: 'Logs ansehen (Strg+C zurück zum Menü)',
      steps: [
        {
          kind: 'compose',
          profiles,
          args: ['logs', '-f', '--tail', '100'],
          service: 'optional',
        },
      ],
    },
    {
      id: 'shell',
      group: GROUP_WATCH,
      label: 'Shell in einem Container',
      steps: [{ kind: 'compose', profiles, args: ['exec'], service: 'required' }],
    },
  ];
}

function databaseActions(stack: Stack): readonly Action[] {
  const profiles = profilesOf(stack);
  const seedProfiles = stack.mode === 'dev' ? profiles : ['demo'];
  return [
    {
      id: 'migrate',
      group: GROUP_DATABASE,
      label: 'Migrationen ausführen',
      steps: [{ kind: 'compose', profiles, args: ['run', '--rm', 'migrate'] }],
    },
    {
      id: 'seed',
      group: GROUP_DATABASE,
      label: 'Demo-Praxen einspielen (synthetische Daten)',
      steps: [{ kind: 'compose', profiles: seedProfiles, args: ['run', '--rm', 'seed'] }],
    },
    {
      id: 'psql',
      group: GROUP_DATABASE,
      label: 'Datenbank-Konsole (psql)',
      steps: [{ kind: 'compose', profiles, args: ['exec', 'db', 'psql', '-U', 'postgres'] }],
    },
    {
      id: 'reset-db',
      group: GROUP_DATABASE,
      label: 'Datenbank zurücksetzen und neu starten (löscht alle Daten)',
      confirm: `Alle Daten der Datenbank im Betrieb ${stack.mode} werden gelöscht.`,
      steps: [
        { kind: 'compose', profiles: ALL_PROFILES, args: ['down', '-v', '--remove-orphans'] },
        ...upSteps(stack),
        { kind: 'links' },
      ],
    },
  ];
}

function testActions(stack: Stack): readonly Action[] {
  const smoke: Action = {
    id: 'smoke',
    group: GROUP_TESTS,
    label: 'Smoke-Test gegen die laufenden Container',
    steps: [{ kind: 'smoke' }],
  };
  if (stack.mode === 'prod') return [smoke];
  const tools = ['tools'];
  const inContainer = (id: string, label: string, service: string): Action => ({
    id,
    group: GROUP_TESTS,
    label,
    // Built first: the containers hold a copy of the sources.
    steps: [
      { kind: 'compose', profiles: tools, args: ['build', service] },
      { kind: 'compose', profiles: tools, args: ['run', '--rm', '--no-deps', service] },
    ],
  });
  return [
    inContainer('check', 'Lint, Typprüfung und Unit-Tests', 'tools'),
    inContainer('integration', 'Integrationstests (eigene Test-Datenbank)', 'integration'),
    inContainer('e2e', 'End-to-End-Tests im Browser (Chromium)', 'e2e'),
    smoke,
  ];
}

function cleanActions(stack: Stack): readonly Action[] {
  return [
    {
      id: 'down',
      group: GROUP_CLEAN,
      label: 'Container entfernen (Daten bleiben)',
      steps: [{ kind: 'compose', profiles: ALL_PROFILES, args: ['down', '--remove-orphans'] }],
    },
    {
      id: 'purge',
      group: GROUP_CLEAN,
      label: 'Alles dieses Betriebs entfernen: Container, Images, Datenbank',
      confirm: `Container, Images und alle Daten des Betriebs ${stack.mode} werden gelöscht.`,
      steps: [
        {
          kind: 'compose',
          profiles: ALL_PROFILES,
          args: ['down', '-v', '--rmi', 'all', '--remove-orphans'],
        },
      ],
    },
    {
      id: 'clean-caches',
      group: GROUP_CLEAN,
      label: 'Cache des Projekts leeren (.turbo, .next, dist, coverage, reports)',
      steps: [{ kind: 'clean-caches' }],
    },
    {
      id: 'clean-docker-cache',
      group: GROUP_CLEAN,
      label: 'Docker-Build-Cache leeren',
      confirm: 'Der Build-Cache von Docker wird gelöscht, auch der anderer Projekte.',
      steps: [{ kind: 'docker', args: ['builder', 'prune', '-f'] }],
    },
    {
      id: 'clean-node-modules',
      group: GROUP_CLEAN,
      label: 'node_modules auf diesem Rechner löschen (Docker braucht sie nicht)',
      confirm:
        'Danach gehen Git-Hooks, Editor-Hilfen und pnpm-Befehle erst wieder nach "pnpm install".',
      steps: [{ kind: 'clean-node-modules' }],
    },
  ];
}

/** The menu of one stack, in the order shown. */
export function actionsOf(stack: Stack): readonly Action[] {
  return [
    ...runActions(stack),
    ...watchActions(stack),
    ...databaseActions(stack),
    ...testActions(stack),
    ...cleanActions(stack),
  ];
}

/** The arguments of `docker` for one compose step. */
export function composeArguments(
  stack: Stack,
  step: Extract<Step, { kind: 'compose' }>,
  service?: string,
): readonly string[] {
  // A shell is one extra word after the service: `exec api sh`.
  const shell = step.service === 'required' ? ['sh'] : [];
  return [
    'compose',
    '--env-file',
    stack.envFile,
    '-f',
    stack.composeFile,
    ...(step.profiles ?? []).flatMap((profile) => ['--profile', profile]),
    ...step.args,
    ...(service === undefined ? [] : [service, ...shell]),
  ];
}
