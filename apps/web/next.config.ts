import path from 'node:path';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/**
 * The static headers of every response (03 §3). Next writes them into its build output, so they
 * read no environment: one build serves every environment. What depends on the request or the
 * environment is in `src/proxy.ts`.
 */
export const SECURITY_HEADERS = [
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

export default function config(phase: string): NextConfig {
  return withNextIntl({
    poweredByHeader: false,
    reactStrictMode: true,
    reactCompiler: true,
    // Ships as TypeScript source: only bundlers consume it (ADR 0012).
    transpilePackages: ['@medibooker/api-client'],
    // The root layouts live under [locale], so a language we lack needs its own 404 page.
    experimental: { globalNotFound: true },
    // The Docker image runs the standalone server; `next start` (the e2e tests) needs the normal
    // output. NEXT_OUTPUT is set only while the image builds.
    ...(process.env.NEXT_OUTPUT === 'standalone'
      ? {
          output: 'standalone',
          outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
        }
      : {}),
    headers: () => Promise.resolve([{ source: '/:path*', headers: SECURITY_HEADERS }]),
    // Same-origin in development too, as behind the proxy in production.
    ...(phase === PHASE_DEVELOPMENT_SERVER
      ? {
          rewrites: () =>
            Promise.resolve([
              {
                source: '/api/v1/:path*',
                destination: `${process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001'}/api/v1/:path*`,
              },
            ]),
        }
      : {}),
  });
}
