/**
 * The control menu of the two Docker stacks (07 §2): `medibooker.cmd` or `medibooker.sh` without
 * arguments asks for the mode and shows the list; `medibooker dev up` runs one entry directly, for
 * scripts and CI. It needs only Node and Docker: no import from node_modules, so it runs on a fresh
 * clone and after "node_modules löschen".
 */
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  actionsOf,
  composeArguments,
  dockerEnvironment,
  type Action,
  type Step,
} from './lib/control/actions.ts';
import {
  allPassed,
  healthChecks,
  runChecks,
  smokeChecks,
  type Check,
} from './lib/control/checks.ts';
import { cachePaths, nodeModulesPaths, removeFolders } from './lib/control/clean.ts';
import {
  azureStringProblem,
  DEFAULT_MAIL_HOST,
  ensureEnvFile,
  isHostName,
  isMailAddress,
  isSwaggerEnabled,
  mailServerOf,
  storageAccountOf,
  writeMailServer,
  writePracticeSlug,
  writeStorageAccount,
} from './lib/control/env-files.ts';
import { lineReader, type LineReader } from './lib/control/lines.ts';
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
/** What a step returns when the user took it back: no failure, and the action ends. */
const CANCELLED = -1;

const USAGE = `Aufruf:
  medibooker                     Menü: erst der Betrieb, dann die Liste
  medibooker <dev|prod> <aktion> [dienst|adresse]   Eine Aktion direkt ausführen

Optionen:
  --yes       Rückfragen vor dem Löschen beantworten
  --dry-run   Nur zeigen, welche Befehle laufen würden`;

interface Session {
  readonly dryRun: boolean;
  readonly assumeYes: boolean;
  readonly lines: LineReader | undefined;
  /** The service, or the address of a test e-mail, given on the command line. */
  readonly service: string | undefined;
}

/** The session's lines, or for a direct call lines of its own for this one question. */
async function withLines<T>(session: Session, use: (lines: LineReader) => Promise<T>): Promise<T> {
  if (session.lines !== undefined) return use(session.lines);
  const lines = lineReader();
  try {
    return await use(lines);
  } finally {
    lines.close();
  }
}

function runDocker(args: readonly string[], session: Session): Promise<number> {
  if (session.dryRun) {
    console.log(style.dim(`docker ${args.join(' ')}`));
    return Promise.resolve(0);
  }
  session.lines?.pause();
  return new Promise((resolve) => {
    const child = spawn('docker', [...args], {
      cwd: ROOT,
      stdio: 'inherit',
      env: dockerEnvironment(process.env),
    });
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

/** An address the user names; undefined when the user took it back or typed no address. */
async function addressOf(session: Session, question: string): Promise<string | undefined> {
  const answer = session.service ?? (await withLines(session, (lines) => lines.ask(question)));
  const address = answer?.trim() ?? '';
  if (address === '') return undefined;
  if (isMailAddress(address)) return address;
  console.error(style.red('Das ist keine E-Mail-Adresse.'));
  return undefined;
}

/** A new practice as the menu asks for it (A04); `medibooker-db practice create` judges it. */
interface PracticeAnswers {
  readonly slug: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly market: string;
  readonly timeZone: string;
  readonly locale: string;
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Asks for a new practice; undefined when the user stops or an answer cannot be one. */
async function practiceOf(session: Session): Promise<PracticeAnswers | undefined> {
  return withLines(session, async (lines) => {
    const ask = async (question: string) => (await lines.ask(question))?.trim() ?? '';
    const slug = (
      await ask('Kürzel der Praxis, z. B. praxis-mueller (Enter = abbrechen): ')
    ).toLowerCase();
    if (slug === '') return undefined;
    const nameAr = await ask('Name auf Arabisch: ');
    const nameEn = await ask('Name auf Englisch: ');
    const market = (await ask('Markt, zwei Buchstaben wie SA oder DE: ')).toUpperCase();
    const timeZone = await ask('Zeitzone, z. B. Asia/Riyadh oder Europe/Berlin: ');
    const locale = (await ask('Standardsprache ar oder en [ar]: ')).toLowerCase() || 'ar';
    if (
      nameAr === '' ||
      nameEn === '' ||
      !/^[A-Z]{2}$/.test(market) ||
      !isTimeZone(timeZone) ||
      !['ar', 'en'].includes(locale)
    ) {
      console.error(
        style.red(
          'Unvollständig: beide Namen, ein Markt aus zwei Buchstaben, eine IANA-Zeitzone, ar oder en.',
        ),
      );
      return undefined;
    }
    return { slug, nameAr, nameEn, market, timeZone, locale };
  });
}

function practiceArguments(practice: PracticeAnswers): readonly string[] {
  return [
    '--slug',
    practice.slug,
    '--name-ar',
    practice.nameAr,
    '--name-en',
    practice.nameEn,
    '--market',
    practice.market,
    '--time-zone',
    practice.timeZone,
    '--default-locale',
    practice.locale,
  ];
}

/**
 * After a new practice: names it in the stack's environment file, if the user wants. API and web
 * read it when they are created, so "Starten" brings it; the page stays hidden until its admin
 * publishes it.
 */
async function offerPracticeSlug(stack: Stack, session: Session, slug: string): Promise<void> {
  const answer = session.assumeYes
    ? 'j'
    : await withLines(session, (lines) =>
        lines.ask(`PRACTICE_SLUG in ${stack.envFile} auf ${slug} setzen? [j/N] `),
      );
  if (!/^(j|ja|y|yes)$/i.test(answer?.trim() ?? '')) {
    console.log(`Später: PRACTICE_SLUG=${slug} in ${stack.envFile}, dann "Starten".`);
    return;
  }
  if (session.dryRun) {
    console.log(style.dim(`${stack.envFile}: PRACTICE_SLUG=${slug} setzen`));
    return;
  }
  writePracticeSlug(stack, ROOT, slug);
  console.log(
    `${stack.envFile}: PRACTICE_SLUG=${slug}. Jetzt "Starten", damit API und Web sie zeigen.`,
  );
}

/** False where a secret would show while it is typed, which it then says. */
function canHideInput(secret: string): boolean {
  // Git Bash's own terminal hands a program a pipe, and itself shows what is typed.
  if (process.stdin.isTTY || process.env.MSYSTEM === undefined) return true;
  console.error(
    style.red(`Hier wäre ${secret} sichtbar: bitte medibooker.cmd in PowerShell oder cmd starten.`),
  );
  return false;
}

/** Promises a hidden answer only where it can keep that promise. */
function hiddenPrompt(name: string): string {
  return process.stdin.isTTY
    ? `${name} (wird nicht angezeigt, Enter = abbrechen): `
    : `${name} (Enter = abbrechen): `;
}

/** Writes a mailbox into the stack's environment file. Its password is never shown. */
function setUpMailServer(stack: Stack, session: Session): Promise<number> {
  if (!canHideInput('das Passwort')) return Promise.resolve(CANCELLED);
  return withLines(session, async (lines) => {
    console.log(`Adresse und Passwort kommen nur in ${stack.envFile}, die Git nicht kennt.`);
    const address = (await lines.ask('Adresse des Postfachs (Enter = abbrechen): '))?.trim() ?? '';
    if (address === '') return CANCELLED;
    const server = (await lines.ask(`Server [${DEFAULT_MAIL_HOST}]: `))?.trim() ?? '';
    const host = server === '' ? DEFAULT_MAIL_HOST : server;
    const others =
      (
        await lines.ask(
          `Wer darf echte E-Mails bekommen? Weitere Adressen mit Komma (Enter = nur ${address}): `,
        )
      )?.trim() ?? '';
    const allowed = others === '' ? [] : others.split(',').map((other) => other.trim());
    if (!isMailAddress(address) || !isHostName(host) || !allowed.every(isMailAddress)) {
      console.error(style.red('Eine Adresse oder der Server sehen nicht richtig aus.'));
      return CANCELLED;
    }
    const password = await lines.askHidden(hiddenPrompt('Passwort'));
    if (password === undefined || password === '') return CANCELLED;
    if (session.dryRun) {
      console.log(
        style.dim(`${stack.envFile}: SMTP_URL, MAIL_FROM, MAIL_ALLOWED_RECIPIENTS setzen`),
      );
    } else {
      writeMailServer(stack, ROOT, { address, host, password, allowed });
      console.log(`${stack.envFile}: Mailserver ${host} eingetragen.`);
      console.log(`Echte E-Mails gehen nur an: ${[address, ...allowed].join(', ')}`);
    }
    return 0;
  });
}

function removeMailServer(stack: Stack, session: Session): number {
  if (session.dryRun) {
    console.log(
      style.dim(`${stack.envFile}: SMTP_URL, MAIL_FROM, MAIL_ALLOWED_RECIPIENTS entfernen`),
    );
  } else {
    writeMailServer(stack, ROOT, undefined);
    console.log(`${stack.envFile}: Mailserver entfernt, die E-Mails gehen wieder an Mailpit.`);
  }
  return 0;
}

/** Writes an Azure account into the stack's environment file. Its string is never shown. */
function setUpStorage(stack: Stack, session: Session): Promise<number> {
  if (!canHideInput('der Connection String')) return Promise.resolve(CANCELLED);
  return withLines(session, async (lines) => {
    console.log(`Der Connection String kommt nur in ${stack.envFile}, die Git nicht kennt.`);
    const value = (await lines.askHidden(hiddenPrompt('Connection String')))?.trim() ?? '';
    if (value === '') return CANCELLED;
    const problem = azureStringProblem(value);
    if (problem !== undefined) {
      console.error(style.red(problem));
      return CANCELLED;
    }
    if (session.dryRun) {
      console.log(
        style.dim(`${stack.envFile}: STORAGE_PROVIDER, STORAGE_AZURE_CONNECTION_STRING setzen`),
      );
    } else {
      writeStorageAccount(stack, ROOT, value);
      console.log(`${stack.envFile}: Azure-Speicher eingetragen.`);
      console.log('Nur synthetische Dateien, bis Vertrag und Region stehen (RT-95).');
    }
    return 0;
  });
}

function removeStorage(stack: Stack, session: Session): number {
  if (session.dryRun) {
    console.log(
      style.dim(`${stack.envFile}: STORAGE_PROVIDER, STORAGE_AZURE_CONNECTION_STRING entfernen`),
    );
  } else {
    writeStorageAccount(stack, ROOT, undefined);
    console.log(`${stack.envFile}: Azure-Speicher ausgetragen, die Dateien bleiben im Konto.`);
  }
  return 0;
}

async function runStep(step: Step, stack: Stack, session: Session): Promise<number> {
  switch (step.kind) {
    case 'compose': {
      if (step.practice === true) {
        // One reader for every question of this step: a direct call reads them from one input.
        return withLines(session, async (lines) => {
          const asking: Session = { ...session, lines };
          const practice = await practiceOf(asking);
          if (practice === undefined) return CANCELLED;
          const code = await runDocker(
            composeArguments(stack, step, undefined, practiceArguments(practice)),
            asking,
          );
          if (code === 0) await offerPracticeSlug(stack, asking, practice.slug);
          return code;
        });
      }
      if (step.recipient === true || step.account === true) {
        const question =
          step.account === true
            ? 'E-Mail-Adresse des Kontos (Enter = abbrechen): '
            : 'Test-E-Mail an (Enter = abbrechen): ';
        const address = await addressOf(session, question);
        if (address === undefined) return CANCELLED;
        return runDocker(composeArguments(stack, step, address), session);
      }
      const service =
        step.service === undefined ? undefined : await chooseService(step, stack, session);
      return runDocker(composeArguments(stack, step, service), session);
    }
    case 'docker':
      return runDocker(step.args, session);
    case 'links':
      console.log(
        renderLinks(
          stack,
          linksOf(
            stack,
            isSwaggerEnabled(stack, ROOT),
            mailServerOf(stack, ROOT),
            storageAccountOf(stack, ROOT),
          ),
          style,
        ),
      );
      return 0;
    case 'health':
      return runCheckStep(`Health (${stack.mode})`, healthChecks(stack), session);
    case 'smoke': {
      const mailServer = mailServerOf(stack, ROOT);
      if (mailServer !== undefined) {
        console.log(
          style.yellow(
            `Ohne Test-Registrierung: sie würde eine echte E-Mail über ${mailServer} schicken. Den Mailserver prüft "Test-E-Mail senden".`,
          ),
        );
      }
      return runCheckStep(
        `Smoke-Test (${stack.mode})`,
        smokeChecks(stack, {
          swaggerEnabled: isSwaggerEnabled(stack, ROOT),
          catchesMail: mailServer === undefined,
        }),
        session,
      );
    }
    case 'mail-setup':
      return setUpMailServer(stack, session);
    case 'mail-off':
      return removeMailServer(stack, session);
    case 'storage-setup':
      return setUpStorage(stack, session);
    case 'storage-off':
      return removeStorage(stack, session);
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
    if (code === CANCELLED) {
      console.log('Abgebrochen.');
      return 1;
    }
    // The health check reports and goes on: the links stay useful while a service starts.
    if (code !== 0 && step.kind !== 'health') {
      console.error(style.red(`Fehlgeschlagen (Code ${String(code)}).`));
      if (action.failureHint !== undefined) console.error(action.failureHint);
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
