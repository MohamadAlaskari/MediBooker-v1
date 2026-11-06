import { describe, expect, it } from 'vitest';
import { buildCsp } from './csp';

function directive(csp: string, name: string): string | undefined {
  return csp.split('; ').find((part) => part.startsWith(`${name} `));
}

describe('buildCsp (03 §4)', () => {
  it('allows only nonced scripts in production, never inline ones', () => {
    const csp = buildCsp('abc', { dev: false });
    expect(directive(csp, 'script-src')).toBe("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(directive(csp, 'style-src')).toBe("style-src 'self' 'nonce-abc'");
    expect(csp).not.toContain('unsafe-eval');
  });

  it('adds what hot reloading needs only in development', () => {
    const csp = buildCsp('abc', { dev: true });
    expect(directive(csp, 'script-src')).toContain("'unsafe-eval'");
    expect(directive(csp, 'style-src')).toBe("style-src 'self' 'unsafe-inline'");
  });

  it('closes objects, the base URI and framing, and allows only this origin otherwise', () => {
    const csp = buildCsp('abc', { dev: false });
    expect(directive(csp, 'default-src')).toBe("default-src 'self'");
    expect(directive(csp, 'object-src')).toBe("object-src 'none'");
    expect(directive(csp, 'base-uri')).toBe("base-uri 'none'");
    expect(directive(csp, 'frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive(csp, 'connect-src')).toBe("connect-src 'self'");
  });
});
