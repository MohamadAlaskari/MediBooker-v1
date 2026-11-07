/**
 * BR-24, as filters on staff members. Whom the API may name to the outside: not hidden by an admin,
 * and with the person's own consent, which takes effect at once when it is withdrawn.
 */
export const PUBLIC_PROFILE = {
  hiddenAt: null,
  consents: { some: { type: 'PUBLIC_PROFILE', withdrawnAt: null } },
} as const;

export const PUBLIC_PROVIDER = { ...PUBLIC_PROFILE, isProvider: true } as const;
