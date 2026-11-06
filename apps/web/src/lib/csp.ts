export interface CspOptions {
  /** `next dev`: hot reloading needs `eval` and styles without a nonce. */
  readonly dev: boolean;
}

/**
 * The Content-Security-Policy of a page (03 §4). The nonce is new for every request, and
 * 'strict-dynamic' lets Next's nonced scripts load their own chunks. Never 'unsafe-inline' for
 * scripts: a practice page shows text that practices write.
 */
export function buildCsp(nonce: string, { dev }: CspOptions): string {
  const scripts = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(dev ? ["'unsafe-eval'"] : []),
  ];
  const styles = dev ? ["'self'", "'unsafe-inline'"] : ["'self'", `'nonce-${nonce}'`];
  return [
    "default-src 'self'",
    `script-src ${scripts.join(' ')}`,
    `style-src ${styles.join(' ')}`,
    // Server-rendered style attributes from CSS variables and positioning.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}
