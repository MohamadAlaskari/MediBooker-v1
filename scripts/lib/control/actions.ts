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
      /** Appends the address the user names to the arguments: of a test e-mail. */
      readonly recipient?: true;
      /** Appends the address the user names to the arguments: of an account. */
      readonly account?: true;
    }
  | { readonly kind: 'docker'; readonly args: readonly string[] }
  | {
      readonly kind:
        | 'links'
        | 'health'
        | 'smoke'
        | 'mail-setup'
        | 'mail-off'
        | 'storage-setup'
        | 'storage-off'
        | 'clean-caches'
        | 'clean-node-modules';
    };

export interface Action {
  readonly id: string;
  readonly group: string;
  readonly label: string;
  /** Asked before a step that deletes something. */
  readonly confirm?: string;
  /** What a failure means, if there is more to say than the exit code. */
  readonly failureHint?: string;
  readonly steps: readonly Step[];
}

const GROUP_RUN = 'Aufbauen und ausführen';
const GROUP_WATCH = 'Überwachen';
const GROUP_DATABASE = 'Datenbank';
const GROUP_MAIL = 'E-Mail';
const GROUP_FILES = 'Dateien';
const GROUP_TESTS = 'Tests';
const GROUP_CLEAN = 'Aufräumen';
const GROUP_PRACTICE = 'Praxis';

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
  // Its command removes every volume of the stack, also the emulator's.
  const alsoDeleted = stack.storageEmulator === undefined ? '' : ' und alle Dateien in Azurite';
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
      steps: [
        { kind: 'compose', profiles: seedProfiles, args: ['run', '--rm', 'seed'] },
        // The API generates slots at its start, which here is over already.
        {
          kind: 'compose',
          profiles: seedProfiles,
          args: ['exec', 'api', 'node', 'dist/cli/generate-slots.js'],
        },
      ],
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
      confirm: `Alle Daten der Datenbank${alsoDeleted} im Betrieb ${stack.mode} werden gelöscht.`,
      steps: [
        { kind: 'compose', profiles: ALL_PROFILES, args: ['down', '-v', '--remove-orphans'] },
        ...upSteps(stack),
        { kind: 'links' },
      ],
    },
  ];
}

/**
 * A real mail server instead of the stack's Mailpit. The environment reaches a container when it is
 * created, so both changes end in `up`, which creates the API anew; "Neu starten" would keep the old.
 */
function mailActions(stack: Stack): readonly Action[] {
  return [
    {
      id: 'mail-setup',
      group: GROUP_MAIL,
      label: 'Mailserver eintragen (Postfach und Passwort), dann neu starten',
      steps: [{ kind: 'mail-setup' }, ...upSteps(stack), { kind: 'links' }],
    },
    {
      id: 'mail-test',
      group: GROUP_MAIL,
      label: 'Test-E-Mail senden',
      failureHint:
        'EAUTH: Adresse oder Passwort falsch. ETIMEDOUT, ESOCKET, ECONNECTION, EDNS: Server nicht erreichbar. EENVELOPE: Empfänger abgelehnt. RECIPIENT_NOT_ALLOWED: nicht freigegeben, "Mailserver eintragen" setzt die Liste.',
      steps: [
        {
          kind: 'compose',
          profiles: profilesOf(stack),
          args: ['exec', 'api', 'node', 'dist/cli/send-test-mail.js'],
          recipient: true,
        },
      ],
    },
    {
      id: 'mail-off',
      group: GROUP_MAIL,
      label: 'Mailserver austragen: zurück zu Mailpit, dann neu starten',
      steps: [{ kind: 'mail-off' }, ...upSteps(stack), { kind: 'links' }],
    },
  ];
}

/**
 * Where the stack's files go. A stack with an emulator has nothing to enter. For the others, as with
 * the mail server, both changes end in `up`, which creates the API anew with its new environment.
 */
function storageActions(stack: Stack): readonly Action[] {
  const test: Action = {
    id: 'storage-test',
    group: GROUP_FILES,
    label: 'Datei-Speicher prüfen',
    failureHint:
      'NOT_CONFIGURED: kein Speicher eingetragen. REFUSED: Konto oder Schlüssel falsch, oder das Konto sperrt diesen Rechner aus. UNAVAILABLE: Speicher nicht erreichbar (Netz, Endpunkt, Azurite). FAILED: unerwartete Antwort; die Zeile oben nennt den Schritt und den Code.',
    steps: [
      {
        kind: 'compose',
        profiles: profilesOf(stack),
        args: ['exec', 'api', 'node', 'dist/cli/check-storage.js'],
      },
    ],
  };
  if (stack.storageEmulator !== undefined) return [test];
  return [
    {
      id: 'storage-setup',
      group: GROUP_FILES,
      label: 'Azure-Speicher eintragen (Connection String), dann neu starten',
      steps: [{ kind: 'storage-setup' }, ...upSteps(stack), { kind: 'links' }],
    },
    test,
    {
      id: 'storage-off',
      group: GROUP_FILES,
      label: 'Azure-Speicher austragen, dann neu starten',
      steps: [{ kind: 'storage-off' }, ...upSteps(stack), { kind: 'links' }],
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

/**
 * The team of the installation's practice (A04): the operator gives an existing account with a
 * confirmed address the admin role, which nobody else can before there is an admin. At the end of
 * the menu, so that the numbers of the other entries stay as they were.
 */
function practiceActions(stack: Stack): readonly Action[] {
  return [
    {
      id: 'staff-admin',
      group: GROUP_PRACTICE,
      label: 'Konto zum Admin der Praxis machen (bestätigte E-Mail-Adresse)',
      failureHint:
        'ACCOUNT_NOT_FOUND: kein Konto mit genau dieser Adresse; die Schreibweise prüfen (etwa .de statt .com), sonst erst registrieren. EMAIL_NOT_VERIFIED: erst den Link der E-Mail öffnen. NO_PRACTICE: keine Praxis eingespielt ("Demo-Praxen einspielen").',
      steps: [
        {
          kind: 'compose',
          profiles: profilesOf(stack),
          args: ['exec', 'api', 'node', 'dist/cli/staff-role.js'],
          account: true,
        },
      ],
    },
  ];
}

/** The menu of one stack, in the order shown. */
export function actionsOf(stack: Stack): readonly Action[] {
  return [
    ...runActions(stack),
    ...watchActions(stack),
    ...databaseActions(stack),
    ...mailActions(stack),
    ...storageActions(stack),
    ...testActions(stack),
    ...cleanActions(stack),
    ...practiceActions(stack),
  ];
}

/**
 * The environment of every `docker` call of the menu. Docker Desktop's plugin hooks print hints
 * such as "Debug this Compose error with Gordon" after a command in a terminal, which reads as an
 * error of the stack; `DOCKER_CLI_HOOKS` comes before the configuration file and switches them off.
 */
export function dockerEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...environment, DOCKER_CLI_HOOKS: 'false' };
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
