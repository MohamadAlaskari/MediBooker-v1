/** The two Docker stacks of the control menu (07 §2): what differs between them is only data. */
export const MODES = ['dev', 'prod'] as const;
export type Mode = (typeof MODES)[number];

export function isMode(value: string): value is Mode {
  return (MODES as readonly string[]).includes(value);
}

export interface Stack {
  readonly mode: Mode;
  /** One line for the first question. */
  readonly summary: string;
  readonly composeFile: string;
  /** Gitignored; the control program creates it (env-files.ts). */
  readonly envFile: string;
  /** What a visitor opens. */
  readonly webUrl: string;
  /** Where a visitor reaches the API. */
  readonly apiUrl: string;
  /** Where the probes reach the API and the web app, past the proxy. */
  readonly apiProbeUrl: string;
  readonly webProbeUrl: string;
  /** The compose profile of the running application; undefined when it needs none. */
  readonly appProfile: string | undefined;
  /** The Mailpit of this stack: its e-mails end up here unless its environment file names a server. */
  readonly mailUrl: string;
  /**
   * The emulator that holds this stack's files: where a browser reaches it and where the probe asks.
   * undefined: the stack has no emulator, and its files go to the account its environment file names.
   */
  readonly storageEmulator: { readonly url: string; readonly probeUrl: string } | undefined;
  /** The services that keep running and can be restarted. */
  readonly runningServices: readonly string[];
  /** The services a log or a shell can be asked for. */
  readonly services: readonly string[];
}

export const STACKS: Readonly<Record<Mode, Stack>> = {
  dev: {
    mode: 'dev',
    summary: 'Entwicklung: Live-Reload, Swagger, Demo-Praxen',
    composeFile: 'compose.dev.yaml',
    envFile: '.env',
    webUrl: 'http://localhost:3000',
    apiUrl: 'http://localhost:3001',
    apiProbeUrl: 'http://localhost:3001',
    webProbeUrl: 'http://localhost:3000',
    mailUrl: 'http://localhost:8025',
    storageEmulator: {
      url: 'http://localhost:10000/devstoreaccount1',
      probeUrl: 'http://127.0.0.1:10000/devstoreaccount1',
    },
    appProfile: 'app',
    runningServices: ['api', 'web', 'mailpit', 'azurite'],
    services: ['api', 'web', 'mailpit', 'azurite', 'db', 'migrate', 'seed'],
  },
  prod: {
    mode: 'prod',
    summary: 'Produktion auf diesem Rechner: gebaute Images, schreibgeschützt, hinter dem Proxy',
    composeFile: 'compose.prod.yaml',
    envFile: '.env.prod',
    webUrl: 'http://localhost:8080',
    apiUrl: 'http://localhost:8080',
    apiProbeUrl: 'http://localhost:8081',
    webProbeUrl: 'http://localhost:8082',
    mailUrl: 'http://localhost:8083',
    storageEmulator: undefined,
    appProfile: undefined,
    runningServices: ['api', 'web', 'proxy', 'mailpit'],
    services: ['proxy', 'api', 'web', 'mailpit', 'db', 'migrate'],
  },
};

/** The practice the seed creates; the links and the smoke test use it. */
export const DEMO_PRACTICE = 'al-noor';

/** A service of that practice that can be booked online. */
export const DEMO_SERVICE = '00000001-0000-4000-8100-000000000001';

export interface Link {
  readonly label: string;
  readonly target: string;
}

/** Where the files of this stack go: its emulator, the account's name, or nowhere yet. */
function storageLink({ storageEmulator }: Stack, storageAccount: string | undefined): Link {
  if (storageEmulator !== undefined) {
    return { label: 'Dateien (Azurite)', target: storageEmulator.url };
  }
  return {
    label: 'Dateien',
    target:
      storageAccount === undefined
        ? 'kein Speicher eingetragen (Menü: "Azure-Speicher eintragen")'
        : `Azure-Konto ${storageAccount}`,
  };
}

/**
 * Swagger is off in the production stack unless `.env.prod` turns it on. `mailServer` is the host of
 * a real mail server: then nobody should look for the e-mails in the Mailpit. `storageAccount` is
 * the name of an entered account, never its connection string.
 */
export function linksOf(
  stack: Stack,
  swaggerEnabled: boolean,
  mailServer?: string,
  storageAccount?: string,
): readonly Link[] {
  const swagger: Link = swaggerEnabled
    ? { label: 'Swagger', target: `${stack.apiProbeUrl}/api/docs` }
    : { label: 'Swagger', target: `aus (in ${stack.envFile}: OPENAPI_UI_ENABLED=true)` };
  const mail: Link =
    mailServer === undefined
      ? { label: 'E-Mails (Mailpit)', target: stack.mailUrl }
      : { label: 'E-Mails', target: `echt über ${mailServer}, nicht im Mailpit` };
  return [
    // The practice of the installation, at the root of its site (ADR 0016).
    { label: 'Praxisseite (Arabisch)', target: `${stack.webUrl}/ar` },
    { label: 'Praxisseite (Englisch)', target: `${stack.webUrl}/en` },
    {
      label: 'Backend (API)',
      target: `${stack.apiUrl}/api/v1/public/practices/${DEMO_PRACTICE}`,
    },
    swagger,
    mail,
    storageLink(stack, storageAccount),
    { label: 'Health API, lebt', target: `${stack.apiProbeUrl}/health/live` },
    { label: 'Health API, bereit', target: `${stack.apiProbeUrl}/health/ready` },
    { label: 'Health Web', target: `${stack.webProbeUrl}/healthz` },
    {
      label: 'Datenbank',
      target:
        stack.mode === 'dev'
          ? 'localhost:5432 (Zugang in .env)'
          : 'nur im Docker-Netz dieses Betriebs',
    },
  ];
}
