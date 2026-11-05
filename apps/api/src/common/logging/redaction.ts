/**
 * Personal and secret fields (health-data-security §1). The field allowlist (log-fields.ts) already
 * removes them from the object of a log call; redaction catches them where the allowlist does not
 * apply, in child-logger bindings.
 */
const SENSITIVE_FIELDS = [
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'mfaSecret',
  'recoveryCodes',
  'deviceToken',
  'email',
  'phone',
  'firstName',
  'lastName',
  'dateOfBirth',
  'insuranceNumber',
  'patientNote',
] as const;

/**
 * pino redaction paths (02 §8), the second line of defence after the allowlist serializers and the
 * field allowlist. A `*` matches one level only, so each field is listed at the top level and one
 * and two levels down (`email`, `*.email`, `*.*.email`; array items count as a level).
 */
export const REDACTED_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  ...SENSITIVE_FIELDS.flatMap((field) => [field, `*.${field}`, `*.*.${field}`]),
];
