import { type NextRequest, NextResponse } from 'next/server';
import { buildCsp } from './lib/csp';
import { localeRedirectPath } from './lib/locale-redirect';

const CSP_HEADER = 'Content-Security-Policy';

/**
 * Runs on every page request (03 §4): sends a path without a locale to the visitor's language, and
 * gives every page a new nonce. The policy also goes on the request headers, because Next reads
 * the nonce for its own scripts from there.
 */
export function proxy(request: NextRequest): NextResponse {
  const target = localeRedirectPath(
    request.nextUrl.pathname,
    request.headers.get('accept-language'),
  );
  if (target !== undefined) {
    const url = request.nextUrl.clone();
    url.pathname = target;
    return NextResponse.redirect(url, 307);
  }
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce, { dev: process.env.NODE_ENV === 'development' });
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set(CSP_HEADER, csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set(CSP_HEADER, csp);
  return response;
}

export const config = {
  // Not the API, Next's own files, the container probe or any path with a file extension.
  matcher: ['/((?!api|_next|healthz|.*\\..*).*)'],
};
