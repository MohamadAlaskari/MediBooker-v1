/**
 * The control menu of the two Docker stacks (07 §2): `medibooker.cmd` or `medibooker.sh` without
 * arguments asks for the mode and shows the list; `medibooker dev up` runs one entry directly, for
 * scripts and CI. It needs only Node and Docker: no import from node_modules, so it runs on a fresh
 * clone and after "node_modules löschen".
 */
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { actionsOf, composeArguments, type Action, type Step } from './lib/control/actions.ts';
import {
  allPassed,
  healthChecks,
  runChecks,
  smokeChecks,
  type Check,
} from './lib/control/checks.ts';
import { cachePaths, nodeModulesPaths, removeFolders } from './lib/control/clean.ts';
import { ensureEnvFile, isSwaggerEnabled } from './lib/control/env-files.ts';
import { isMode, linksOf, STACKS, type Mode, type Stack } from './lib/control/stacks.ts';
import {
  actionOfAnswer,
  modeOfAnswer,
  modeQuestion,
  renderChecks,
  renderLinks,
  renderMenu,
  statusLineOf,
  styleOf,
} from './lib/control/view.ts';

const ROOT = path.join(import.meta.dirname, '..');
const style = styleOf(process.stdout.isTTY && process.env.NO_COLOR === undefined);

const NO_DOCKER = 'Docker läuft nicht: bitte Docker Desktop starten.';
const KNOWN_OPTIONS: readonly string[] = ['--yes', '--dry-run'];

const USAGE = `Aufruf:
  medibooker                     Menü: erst der Betrieb, dann die Liste
  medibooker <dev|prod> <aktion> [dienst]   Eine Aktion direkt ausführen

Optionen:
  --yes       Rückfragen vor dem Löschen beantworten
  --dry-run   Nur zeigen, welche Befehle laufen würden`;

/** Lines from stdin, also from a pipe; a child process gets the terminal while it runs. */
function lineReader() {
  const rl = createInterface({ input: process.stdin, terminal: false });
  const lines: string[] = [];
  let closed = false;
  let waiting: ((line: string | undefined) => void) | undefined;
  rl.on('line', (line) => {
    if (waiting === undefined) {
      lines.push(line);
    } else {
      const resume = waiting;
      waiting = undefined;
      resume(line);
    }
  });
  rl.on('close', () => {
    closed = true;
    waiting?.(undefined);
    waiting = undefined;
  });
  return {
    /** The next answer; undefined when the input has ended. */
    ask(prompt: string): Promise<string | undefined> {
      process.stdout.write(prompt);
      const line = lines.shift();
      if (line !== undefined) return Promise.resolve(line);
      if (closed) return Promise.resolve(undefined);
      rl.resume();
      return new Promise((resolve) => {
        waiting = resolve;
      });
    },
    get isWaiting(): boolean {
      return waiting !== undefined;
    },
    pause(): void {
      rl.pause();
    },
    close(): void {
      rl.close();
    },
  };
}

type LineReader = ReturnType<typeof lineReader>;

interface Session {
  readonly dryRun: boolean;
  readonly assumeYes: boolean;
  readonly lines: LineReader | undefined;
  /** The service given on the command line. */
  readonly service: string | undefined;
}

function runDocker(args: readonly string[], session: Session): Promise<number> {
  if (session.dryRun) {
    console.log(style.dim(`docker ${args.join(' ')}`));
    return Promise.resolve(0);
  }
  session.lines?.pause();
  return new Promise((resolve) => {
    const child = spawn('docker', [...args], { cwd: ROOT, stdio: 'inherit' });
    child.on('error', () => {
      resolve(127);
    });
    // Strg+C ends only the child: a log or a watcher goes back to the menu.
    child.on('close', (code) => {
      resolve(code ?? 0);
    });
  });
}

async function chooseService(
  step: Extract<Step, { kind: 'compose' }>,
  stack: Stack,
  session: Session,
) {
  if (session.service !== undefined) return session.service;
  if (step.service === 'required' && session.lines === undefined) return stack.services[0];
  if (session.lines === undefined) return undefined;
  const fallback = step.service === 'required' ? stack.services[0] : 'alle';
  const answer = await session.lines.ask(
    `Dienst [${stack.services.join(', ')}; Enter = ${String(fallback)}]: `,
  );
  const chosen = answer?.trim() ?? '';
  if (stack.services.includes(chosen)) return chosen;
  return step.service === 'required' ? stack.services[0] : undefined;
}

async function runCheckStep(title: string, checks: readonly Check[], session: Session) {
  if (session.dryRun) {
    for (const { url } of checks) console.log(style.dim(`GET ${url}`));
    return 0;
  }
  const results = await runChecks(checks);
  console.log(renderChecks(title, results, style));
  return allPassed(results) ? 0 : 1;
}

function clean(folders: readonly string[], session: Session): number {
  for (const folder of folders) console.log(style.dim(path.relative(ROOT, folder)));
  if (!session.dryRun) removeFolders(ROOT, folders);
  console.log(`${String(folders.length)} Ordner gelöscht.`);
  return 0;
}

async function runStep(step: Step, stack: Stack, session: Session): Promise<number> {
  switch (step.kind) {
    case 'compose': {
      const service =
        step.service === undefined ? undefined : await chooseService(step, stack, session);
      return runDocker(composeArguments(stack, step, service), session);
    }
    case 'docker':
      return runDocker(step.args, session);
    case 'links':
      console.log(renderLinks(stack, linksOf(stack, isSwaggerEnabled(stack, ROOT)), style));
      return 0;
    case 'health':
      return runCheckStep(`Health (${stack.mode})`, healthChecks(stack), session);
    case 'smoke':
      return runCheckStep(
        `Smoke-Test (${stack.mode})`,
        smokeChecks(stack, isSwaggerEnabled(stack, ROOT)),
        session,
      );
    case 'clean-caches':
      return clean(cachePaths(ROOT), session);
    case 'clean-node-modules':
      return clean(nodeModulesPaths(ROOT), session);
  }
}

async function isConfirmed(action: Action, session: Session): Promise<boolean> {
  if (action.confirm === undefined || session.assumeYes || session.dryRun) return true;
  if (session.lines === undefined) {
    console.error(`${action.confirm} Zum Bestätigen: --yes`);
    return false;
  }
  console.log(style.yellow(action.confirm));
  const answer = await session.lines.ask('Zum Bestätigen "ja" eingeben: ');
  return answer?.trim().toLowerCase() === 'ja';
}

async function runAction(action: Action, stack: Stack, session: Session): Promise<number> {
  if (!(await isConfirmed(action, session))) {
    console.log('Abgebrochen.');
    return 1;
  }
  const usesCompose = action.steps.some(({ kind }) => kind === 'compose');
  const usesDocker = usesCompose || action.steps.some(({ kind }) => kind === 'docker');
  if (usesDocker && !session.dryRun && !isDockerRunning()) {
    console.error(style.red(NO_DOCKER));
    return 1;
  }
  if (usesCompose && !session.dryRun && ensureEnvFile(stack, ROOT)) {
    console.log(`${stack.envFile} angelegt.`);
  }
  for (const step of action.steps) {
    const code = await runStep(step, stack, session);
    // The health check reports and goes on: the links stay useful while a service starts.
    if (code !== 0 && step.kind !== 'health') {
      console.error(style.red(`Fehlgeschlagen (Code ${String(code)}).`));
      return code;
    }
  }
  return 0;
}

function isDockerRunning(): boolean {
  return (
    spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { stdio: 'ignore' }).status ===
    0
  );
}

function statusOf(stack: Stack, session: Session): string {
  if (session.dryRun) return 'Probelauf: es wird nichts ausgeführt.';
  if (!isDockerRunning()) return NO_DOCKER;
  const result = spawnSync(
    'docker',
    [
      'compose',
      '--env-file',
      stack.envFile,
      '-f',
      stack.composeFile,
      '--profile',
      '*',
      'ps',
      '--format',
      'json',
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  return statusLineOf(result.status === 0 ? result.stdout : '');
}

/** One stack's list until the user goes back (true) or quits (false). */
async function stackMenu(stack: Stack, session: Session, lines: LineReader): Promise<boolean> {
  const actions = actionsOf(stack);
  for (;;) {
    console.log(renderMenu(stack, actions, statusOf(stack, session), style));
    const answer = await lines.ask('Auswahl: ');
    if (answer === undefined) return false;
    const text = answer.trim().toLowerCase();
    if (text === 'q') return false;
    if (text === 'b') return true;
    const action = actionOfAnswer(actions, text);
    if (action === undefined) {
      if (text !== '') console.log(style.yellow('Bitte eine Nummer aus der Liste.'));
    } else {
      await runAction(action, stack, session);
    }
  }
}

async function interactive(session: Omit<Session, 'lines'>): Promise<number> {
  const lines = lineReader();
  // At a prompt Strg+C leaves the menu; while a child runs it reaches only the child.
  process.on('SIGINT', () => {
    if (lines.isWaiting) process.exit(0);
  });
  const withLines: Session = { ...session, lines };
  for (;;) {
    console.log(modeQuestion(style));
    const answer = await lines.ask('Auswahl: ');
    if (answer === undefined || answer.trim().toLowerCase() === 'q') break;
    const mode = modeOfAnswer(answer);
    if (mode === undefined) {
      console.log(style.yellow('Bitte 1 oder 2.'));
    } else if (!(await stackMenu(STACKS[mode], withLines, lines))) {
      break;
    }
  }
  lines.close();
  return 0;
}

function direct(mode: Mode, actionId: string, session: Omit<Session, 'lines'>): Promise<number> {
  const stack = STACKS[mode];
  const action = actionsOf(stack).find(({ id }) => id === actionId);
  if (action === undefined) {
    const known = actionsOf(stack)
      .map(({ id }) => id)
      .join(', ');
    console.error(`Unbekannte Aktion "${actionId}". Möglich: ${known}`);
    return Promise.resolve(2);
  }
  return runAction(action, stack, { ...session, lines: undefined });
}

async function main(argv: readonly string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return 0;
  }
  // A typing error such as --dryrun must not run the real thing.
  const unknown = argv.filter((arg) => arg.startsWith('-') && !KNOWN_OPTIONS.includes(arg));
  if (unknown.length > 0) {
    console.error(`Unbekannte Option: ${unknown.join(', ')}\n\n${USAGE}`);
    return 2;
  }
  const session = {
    dryRun: argv.includes('--dry-run'),
    assumeYes: argv.includes('--yes'),
  };
  const [mode, actionId, service] = argv.filter((arg) => !arg.startsWith('--'));
  if (mode === undefined) return interactive({ ...session, service: undefined });
  if (!isMode(mode) || actionId === undefined) {
    console.error(USAGE);
    return 2;
  }
  // In a direct call Strg+C reaches the child; this process waits for it to end.
  process.on('SIGINT', () => undefined);
  return direct(mode, actionId, { ...session, service });
}

process.exitCode = await main(process.argv.slice(2));
