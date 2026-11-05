/** The deployment environments of APP_ENV (02 §7). */
export const APP_ENVS = ['local', 'ci', 'staging', 'production'] as const;

export type AppEnv = (typeof APP_ENVS)[number];

export function isAppEnv(value: string): value is AppEnv {
  return (APP_ENVS as readonly string[]).includes(value);
}

/**
 * Only local and ci accept the development secret store, clusters without TLS, the endpoint
 * override and the tools-only superuser URL (02 §6, §7).
 */
export function isLocalOrCi(appEnv: AppEnv): boolean {
  return appEnv === 'local' || appEnv === 'ci';
}
