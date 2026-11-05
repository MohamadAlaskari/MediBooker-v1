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
    }
  | { readonly kind: 'verify'; readonly practiceId: string | undefined }
  | { readonly kind: 'roles-reconcile'; readonly practiceId: string | undefined }
  | { readonly kind: 'reset-local' };

export const USAGE = [
  'medibooker-db migrate platform|all',
  'medibooker-db migrate practices [--practice <id>]',
  'medibooker-db provision <practiceId> --market <CC> [--cluster <id>]',
  'medibooker-db verify [--practice <id>]',
  'medibooker-db roles reconcile [--practice <id>]',
  'medibooker-db reset-local',
].join('; ');

const MARKET = /^[A-Z]{2}$/;

const OPTIONS = {
  practice: { type: 'string' },
  market: { type: 'string' },
  cluster: { type: 'string' },
} as const;

type OptionName = keyof typeof OPTIONS;

/** The name a command has in the output, for example `migrate practices`. */
export function commandName(command: Command): string {
  switch (command.kind) {
    case 'migrate':
      return `migrate ${command.target}`;
    case 'roles-reconcile':
      return 'roles reconcile';
    case 'provision':
    case 'verify':
    case 'reset-local':
      return command.kind;
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
  if (verb === 'provision' && rest.length === 0 && allows('market', 'cluster')) {
    const { market, cluster } = values;
    if (argument === undefined || !isPracticeId(argument)) return undefined;
    if (market === undefined || !MARKET.test(market)) return undefined;
    if (cluster !== undefined && !isClusterId(cluster)) return undefined;
    return { kind: 'provision', practiceId: argument.toLowerCase(), market, clusterId: cluster };
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
