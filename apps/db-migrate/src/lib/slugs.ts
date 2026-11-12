/**
 * The name a practice has in `practice_slugs` (ADR 0016): what PRACTICE_SLUG names to an
 * installation, and what M01 lets an admin change. Lowercase letters, digits and inner hyphens, 3 to
 * 40 characters, which the table's CHECK also holds (without the rule on the ends).
 */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/**
 * Words the web and the API use for themselves, or will (health-data-security §11c), and the
 * product's own name: no practice may take them, so that a path or a link of the product never
 * names a practice. A test holds every first path segment of the web app in this list. M01 moves it
 * to where the API can read it, for a slug the practice's admin changes.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'account',
  'admin',
  'api',
  'appointments',
  'assets',
  'auth',
  'book',
  'check-inbox',
  'dashboard',
  'desk',
  'family',
  'forgot-password',
  'health',
  'healthz',
  'home',
  'invitation',
  'invitations',
  'invite',
  'legal',
  'login',
  'logout',
  'mail',
  'medibooker',
  'patients',
  'practice',
  'practices',
  'privacy',
  'public',
  'record',
  'register',
  'reset-password',
  'robots',
  'secure-account',
  'sessions',
  'settings',
  'sign-in',
  'sign-out',
  'sign-up',
  'signin',
  'signup',
  'sitemap',
  'staff',
  'static',
  'support',
  'unsubscribe',
  'verify-email',
  'www',
]);

/** Undefined for a name a new practice may take; otherwise why not. */
export function slugProblem(slug: string): 'FORMAT' | 'RESERVED' | undefined {
  if (!SLUG_PATTERN.test(slug)) return 'FORMAT';
  return RESERVED_SLUGS.has(slug) ? 'RESERVED' : undefined;
}

/**
 * Code points a name refuses: the line and paragraph separators, and the bidi embeddings, overrides
 * and isolates, which would turn the rest of a line where the name stands (the security review of
 * A04 part 2a). Besides them all C0 and C1 controls. The marks Arabic text needs stay: ZWNJ, ZWJ,
 * LRM, RLM and ALM. As numbers, so that no such character stands in this file.
 */
const REFUSED_CODE_POINTS: ReadonlySet<number> = new Set([
  0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
]);

function isRefused(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  const control = code < 0x20 || (code >= 0x7f && code <= 0x9f);
  return control || REFUSED_CODE_POINTS.has(code);
}

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/gu;

/** A practice's name in one language: trimmed, 2 to 120 characters, two of them letters or digits. */
export function isPracticeName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 120) return false;
  // By code point: `for … of` walks a string as such.
  for (const character of trimmed) if (isRefused(character)) return false;
  return (trimmed.match(LETTER_OR_DIGIT)?.length ?? 0) >= 2;
}
