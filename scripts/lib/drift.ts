/** The files that `pnpm generate` writes and git keeps, so a stale one fails verify and CI. */
export const GENERATED_FILES = [
  'apps/api/openapi.json',
  'packages/api-client/src/generated',
  'packages/design-tokens/css/tokens.css',
  'packages/design-tokens/src/generated/tokens.ts',
] as const;

/** A line per file git reports: changed by the generator, or never added. */
export function driftProblems(changed: readonly string[], untracked: readonly string[]): string[] {
  return [
    ...changed.map(
      (file) => `${file}: differs from what git has; run pnpm generate and git add it`,
    ),
    ...untracked.map((file) => `${file}: is generated but not in git; git add it`),
  ];
}

/** The lines of a git command's output, without blanks. */
export function linesOf(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}
