import { fileURLToPath } from 'node:url';
import { runNode } from './run-node.js';
import { toolEnv } from './tool-env.js';

/** The medibooker-db entry, run with Node's type stripping as `pnpm db:migrate` runs it. */
const CLI = fileURLToPath(new URL('../../../../db-migrate/src/cli.ts', import.meta.url));

/** One medibooker-db run: its exit code, its raw output and its JSON lines (02 §6). */
export interface CliRun {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly lines: readonly Readonly<Record<string, unknown>>[];
}

/**
 * A line that is no JSON object stands in as `{ unparsable: true }`: a parse error would quote
 * the line, and the specs check the raw output for secrets before they print anything of it.
 */
function parseLine(line: string): Readonly<Record<string, unknown>> {
  try {
    const value: unknown = JSON.parse(line);
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Readonly<Record<string, unknown>>;
    }
  } catch {
    // Falls through to the placeholder.
  }
  return { unparsable: true };
}

/**
 * Runs `medibooker-db <args>` in a child process with exactly the given database variables
 * (tool-env.ts) and APP_ENV ci. The output is never printed: specs assert on it.
 */
export async function runMedibookerDb(
  args: readonly string[],
  variables: Readonly<Record<string, string>>,
): Promise<CliRun> {
  const run = await runNode([CLI, ...args], { env: toolEnv({ APP_ENV: 'ci', ...variables }) });
  const lines = run.stdout
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map(parseLine);
  return { ...run, lines };
}
