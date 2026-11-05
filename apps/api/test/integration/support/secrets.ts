import { deriveDevSecret, practiceNames } from '@medibooker/db-migrate';
import type { ClusterSecrets } from './cluster.js';

/** Secrets by name: what a text must never contain. */
export type NamedSecrets = Readonly<Record<string, string>>;

/**
 * The names of the secrets whose values occur in `text`, sorted. Only names, never values: a
 * failing `expect(secretNamesIn(log, secrets)).toEqual([])` prints no secret.
 */
export function secretNamesIn(text: string, secrets: NamedSecrets): string[] {
  return Object.entries(secrets)
    .filter(([, value]) => text.includes(value))
    .map(([name]) => name)
    .sort();
}

/**
 * What the output of a database tool must never contain (02 §6), by label: the names of the
 * secrets it contains, `host` for the cluster's host, `connection string` for a URL.
 */
export function forbiddenIn(text: string, host: string, secrets: NamedSecrets): string[] {
  return [
    ...secretNamesIn(text, secrets),
    ...(text.includes(host) ? ['host'] : []),
    ...(/postgres(?:ql)?:\/\//i.test(text) ? ['connection string'] : []),
  ];
}

/**
 * Every generated secret of a test run: the cluster's passwords, the development secret seed
 * and, derived from the seed, both passwords of each named practice (02 §6).
 */
export function generatedSecrets(
  secrets: ClusterSecrets,
  practiceIds: readonly string[] = [],
): NamedSecrets {
  const practices = practiceIds.flatMap((practiceId) => {
    const names = practiceNames(practiceId);
    return [names.appRole, names.ownerRole].map(
      (role) => [`${role} password`, deriveDevSecret(secrets.DEV_SECRET_SEED, role)] as const,
    );
  });
  return { ...secrets, ...Object.fromEntries(practices) };
}
