import type { Action } from './actions.ts';
import type { CheckResult } from './checks.ts';
import { MODES, STACKS, type Link, type Mode, type Stack } from './stacks.ts';

/** ANSI colours; a pipe or NO_COLOR gets plain text. */
export interface Style {
  readonly bold: (text: string) => string;
  readonly dim: (text: string) => string;
  readonly green: (text: string) => string;
  readonly red: (text: string) => string;
  readonly yellow: (text: string) => string;
}

export function styleOf(enabled: boolean): Style {
  const paint =
    (code: number) =>
    (text: string): string =>
      enabled ? `\u001b[${String(code)}m${text}\u001b[0m` : text;
  return { bold: paint(1), dim: paint(2), green: paint(32), red: paint(31), yellow: paint(33) };
}

const PLAIN = styleOf(false);

export function modeQuestion(style: Style = PLAIN): string {
  const lines = MODES.map(
    (mode, index) =>
      `  ${String(index + 1)}) ${style.bold(mode.padEnd(5))} ${STACKS[mode].summary}`,
  );
  return ['', style.bold('MediBooker: welcher Betrieb?'), ...lines, '  q) Beenden', ''].join('\n');
}

/** `1`, `dev`; undefined for anything else. */
export function modeOfAnswer(answer: string): Mode | undefined {
  const text = answer.trim().toLowerCase();
  return MODES.find((mode, index) => text === mode || text === String(index + 1));
}

/** The menu of one stack: entries numbered from 1 under their group headings. */
export function renderMenu(
  stack: Stack,
  actions: readonly Action[],
  statusLine: string,
  style: Style = PLAIN,
): string {
  const lines = ['', style.bold(`MediBooker ${stack.mode}`), style.dim(statusLine)];
  let group = '';
  actions.forEach((action, index) => {
    if (action.group !== group) {
      group = action.group;
      lines.push('', style.bold(group));
    }
    lines.push(`  ${String(index + 1).padStart(2)}) ${action.label}`);
  });
  lines.push('', '   b) Betrieb wechseln', '   q) Beenden', '');
  return lines.join('\n');
}

/** The action of a menu answer: its number or its id. */
export function actionOfAnswer(actions: readonly Action[], answer: string): Action | undefined {
  const text = answer.trim().toLowerCase();
  if (/^\d+$/.test(text)) return actions[Number(text) - 1];
  return actions.find((action) => action.id === text);
}

export function renderLinks(stack: Stack, links: readonly Link[], style: Style = PLAIN): string {
  const width = Math.max(...links.map(({ label }) => label.length));
  return [
    '',
    style.bold(`Links (${stack.mode})`),
    ...links.map(({ label, target }) => `  ${label.padEnd(width)}  ${target}`),
    '',
  ].join('\n');
}

export function renderChecks(
  title: string,
  results: readonly CheckResult[],
  style: Style = PLAIN,
): string {
  const lines = results.map(({ name, url, ok, problem, hint, advisory }) => {
    if (ok) return `  ${style.green('OK')}      ${name}`;
    const advice = hint === undefined ? '' : `: ${hint}`;
    if (advisory) return `  ${style.yellow('HINWEIS')} ${name}: ${problem}${advice}`;
    return `  ${style.red('FEHLER')}  ${name}: ${problem}${advice}\n          ${style.dim(url)}`;
  });
  const failed = results.filter(({ ok, advisory }) => !ok && !advisory).length;
  const allOk = results.every(({ ok }) => ok);
  const summary =
    failed === 0
      ? style.green(allOk ? `Alle ${String(results.length)} in Ordnung.` : 'Keine Fehler.')
      : style.red(`${String(failed)} von ${String(results.length)} fehlgeschlagen.`);
  return ['', style.bold(title), ...lines, summary, ''].join('\n');
}

interface ContainerState {
  readonly Service?: unknown;
  readonly State?: unknown;
  readonly Health?: unknown;
}

function parseContainers(output: string): readonly ContainerState[] {
  const text = output.trim();
  if (text === '') return [];
  try {
    // Compose writes one object per line; older versions wrote one array.
    const parsed: unknown = text.startsWith('[')
      ? JSON.parse(text)
      : text.split(/\r?\n/).map((line) => JSON.parse(line) as unknown);
    return Array.isArray(parsed) ? (parsed as ContainerState[]) : [];
  } catch {
    return [];
  }
}

/** One line for the menu header, from `docker compose ps --format json`. */
export function statusLineOf(psOutput: string): string {
  const running = parseContainers(psOutput).filter(({ State }) => State === 'running');
  if (running.length === 0) return 'Läuft gerade nicht.';
  const names = running
    .map(({ Service, Health }) => {
      const name = typeof Service === 'string' ? Service : '?';
      return Health === 'unhealthy' || Health === 'starting' ? `${name} (${Health})` : name;
    })
    .sort();
  return `Läuft: ${names.join(', ')}`;
}
