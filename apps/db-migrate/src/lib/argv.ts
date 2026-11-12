import { parseArgs } from 'node:util';
import { isClusterId } from './cluster.ts';
import { isPracticeId } from './names.ts';

/** A parsed command line of medibooker-db (02 §6). */
export type Command =
  | {
      readonly kind: 'migrate';
      readonly target: 'platform' | 'practices' | 'all';
      readonly practiceId: string | undefined;
    }
  | {
      readonly kind: 'provision';
      readonly practiceId: string;
      readonly market: string;
      readonly clusterId: string | undefined;
      readonly timeZone: string | undefined;
      readonly defaultLocale: string | undefined;
    }
  | {
      readonly kind: 'practice-create';
      readonly slug: string;
      readonly names: { readonly ar: string; readonly en: string };
      readonly market: string;
      readonly clusterId: string | undefined;
      readonly timeZone: string | undefined;
      readonly defaultLocale: string | undefined;
    }
  | { readonly kind: 'verify'; readonly practiceId: string | undefined }
  | { readonly kind: 'roles-reconcile'; readonly practiceId: string | undefined }
  | { readonly kind: 'reset-local' };

export const USAGE = [
  'medibooker-db migrate platform|all',
  'medibooker-db migrate practices [--practice <id>]',
  'medibooker-db provision <practiceId> --market <CC> [--cluster <id>] [--time-zone <IANA>] [--default-locale <locale>]',
  'medibooker-db practice create --slug <slug> --name-ar <name> --name-en <name> --market <CC> [--cluster <id>] [--time-zone <IANA>] [--default-locale <locale>]',
  'medibooker-db verify [--practice <id>]',
  'medibooker-db roles reconcile [--practice <id>]',
  'medibooker-db reset-local',
].join('; ');

const MARKET = /^[A-Z]{2}$/;
const LOCALE = /^[a-z]{2}$/;

const OPTIONS = {
  practice: { type: 'string' },
  market: { type: 'string' },
  cluster: { type: 'string' },
  'time-zone': { type: 'string' },
  'default-locale': { type: 'string' },
  slug: { type: 'string' },
  'name-ar': { type: 'string' },
  'name-en': { type: 'string' },
} as const;

type OptionName = keyof typeof OPTIONS;

/** The name a command has in the output, for example `migrate practices`. */
export function commandName(command: Command): string {
  switch (command.kind) {
    case 'migrate':
      return `migrate ${command.target}`;
    case 'roles-reconcile':
      return 'roles reconcile';
    case 'practice-create':
      return 'practice create';
    case 'provision':
    case 'verify':
    case 'reset-local':
      return command.kind;
  }
}

/** Whether the runtime knows this IANA time zone. */
function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function practiceOption(value: string | undefined): string | undefined | null {
  if (value === undefined) return undefined;
  return isPracticeId(value) ? value.toLowerCase() : null;
}

function interpret(
  positionals: readonly string[],
  values: Partial<Record<OptionName, string>>,
): Command | undefined {
  const given = new Set(Object.keys(values));
  const allows = (...names: OptionName[]): boolean =>
    [...given].every((name) => (names as string[]).includes(name));
  const practiceId = practiceOption(values.practice);
  if (practiceId === null) return undefined;
  const [verb, argument, ...rest] = positionals;

  if (verb === 'migrate' && rest.length === 0) {
    if (argument === 'practices' && allows('practice')) {
      return { kind: 'migrate', target: 'practices', practiceId };
    }
    if ((argument === 'platform' || argument === 'all') && allows()) {
      return { kind: 'migrate', target: argument, practiceId: undefined };
    }
    return undefined;
  }
  if (
    verb === 'provision' &&
    rest.length === 0 &&
    allows('market', 'cluster', 'time-zone', 'default-locale')
  ) {
    const { market, cluster, 'time-zone': timeZone, 'default-locale': defaultLocale } = values;
    if (argument === undefined || !isPracticeId(argument)) return undefined;
    if (market === undefined || !MARKET.test(market)) return undefined;
    if (cluster !== undefined && !isClusterId(cluster)) return undefined;
    if (timeZone !== undefined && !isTimeZone(timeZone)) return undefined;
    if (defaultLocale !== undefined && !LOCALE.test(defaultLocale)) return undefined;
    return {
      kind: 'provision',
      practiceId: argument.toLowerCase(),
      market,
      clusterId: cluster,
      timeZone,
      defaultLocale,
    };
  }
  if (
    verb === 'practice' &&
    argument === 'create' &&
    rest.length === 0 &&
    allows('slug', 'name-ar', 'name-en', 'market', 'cluster', 'time-zone', 'default-locale')
  ) {
    const { slug, 'name-ar': nameAr, 'name-en': nameEn, market, cluster } = values;
    const { 'time-zone': timeZone, 'default-locale': defaultLocale } = values;
    // The slug and the names are judged by the command, which answers why (SLUG_NOT_ALLOWED).
    if (slug === undefined || nameAr === undefined || nameEn === undefined) return undefined;
    if (market === undefined || !MARKET.test(market)) return undefined;
    if (cluster !== undefined && !isClusterId(cluster)) return undefined;
    if (timeZone !== undefined && !isTimeZone(timeZone)) return undefined;
    if (defaultLocale !== undefined && !LOCALE.test(defaultLocale)) return undefined;
    return {
      kind: 'practice-create',
      slug,
      names: { ar: nameAr, en: nameEn },
      market,
      clusterId: cluster,
      timeZone,
      defaultLocale,
    };
  }
  if (verb === 'verify' && argument === undefined && allows('practice')) {
    return { kind: 'verify', practiceId };
  }
  if (verb === 'roles' && argument === 'reconcile' && rest.length === 0 && allows('practice')) {
    return { kind: 'roles-reconcile', practiceId };
  }
  if (verb === 'reset-local' && argument === undefined && allows()) {
    return { kind: 'reset-local' };
  }
  return undefined;
}

/**
 * Parses the arguments after `medibooker-db`; undefined for anything that is not exactly one of
 * the commands of USAGE (exit code 2). Only `--name value` and `--name=value` options.
 */
export function parseCommandLine(args: readonly string[]): Command | undefined {
  try {
    const { positionals, values } = parseArgs({
      args: [...args],
      options: OPTIONS,
      allowPositionals: true,
      strict: true,
    });
    return interpret(positionals, values);
  } catch {
    return undefined;
  }
}
