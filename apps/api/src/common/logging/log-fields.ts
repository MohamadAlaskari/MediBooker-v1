import { isUuid } from '../context/request-id.js';

/**
 * The allowlist of log fields (02 §8; health-data-security §7: an allowlist of fields, IDs and not
 * names). `onlyAllowedFields` is pino's `formatters.log`: pino calls it with the object of every log
 * call, of the root logger and of every child, before the serializers and the redaction run. A
 * field that is not listed here, or whose value does not have the field's form, is removed, and the
 * line gets `droppedFields` with their number, never their names: a key can itself be personal
 * data. Child-logger bindings do not pass through it (pino resets the bindings formatter of a
 * child); the redaction covers them, and bindings are set only in `common/logging` (02 §8).
 * Extending the set is a reviewed change.
 */

type ValueRule = (value: unknown) => boolean;

/**
 * A class name, as Nest and nestjs-pino set the context (`ProblemDetailsFilter`). A Nest Logger
 * without a context of its own passes the last argument of a call as the context (nestjs-pino 5.3.1
 * `Logger.call`), so `new Logger().log('booked for %s', email)` would log the e-mail address there:
 * this rule drops it, but a name-shaped value (`Sara`) has the form of a class name, so a Logger is
 * always created with `<Class>.name` (02 §8).
 */
const CLASS_NAME = /^[A-Z][A-Za-z0-9]{0,63}$/;

const isClassName: ValueRule = (value) => typeof value === 'string' && CLASS_NAME.test(value);

const isNumber: ValueRule = (value) => typeof value === 'number';

/** A cluster id: a lowercase slug such as `local` or `eu-central-1` (02 §5). */
const CLUSTER_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

const isClusterId: ValueRule = (value) => typeof value === 'string' && CLUSTER_ID.test(value);

/** A code written in code, in UPPER_SNAKE form, such as `PRACTICE_IDENTITY_MISMATCH`. */
const REASON_CODE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;

const isReasonCode: ValueRule = (value) =>
  typeof value === 'string' && value.length <= 64 && REASON_CODE.test(value);

/** `err`, `req` and `res` take any value: their allowlist serializers decide what is logged. */
const isSerialized: ValueRule = () => true;

/**
 * Reviewed fields: ids, codes, counts and durations, each with the item that logs it and the form
 * of its value, so that the field cannot carry other text. The item that logs another one adds it
 * here with its form.
 */
export const REVIEWED_LOG_FIELDS: ReadonlyMap<string, ValueRule> = new Map([
  // F04: the resolved practice of a request (02 §8) and of the connection manager (02 §5).
  ['practiceId', isUuid],
  // F04: the database cluster of a practice; with the practice id the only database field (02 §8).
  ['clusterId', isClusterId],
  // F04: why a practice cannot be served, the reason of a PracticeUnavailableError (05 §1.3).
  ['reasonCode', isReasonCode],
]);

const ALLOWED_FIELDS: ReadonlyMap<string, ValueRule> = new Map([
  // Written by the framework: nestjs-pino's context, the error and pino-http's access line.
  ['context', isClassName],
  ['err', isSerialized],
  ['req', isSerialized],
  ['res', isSerialized],
  ['responseTime', isNumber],
  ...REVIEWED_LOG_FIELDS,
]);

/**
 * The allowed fields of a log call's object, in their order (so the access line stays exactly as
 * pino-http writes it), plus `droppedFields` when any was removed. An undefined value is skipped,
 * as pino skips it. The object itself is left unchanged.
 */
export function onlyAllowedFields(fields: object): Record<string, unknown> {
  const allowed: Record<string, unknown> = {};
  let droppedFields = 0;
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (ALLOWED_FIELDS.get(key)?.(value) === true) allowed[key] = value;
    else droppedFields += 1;
  }
  return droppedFields === 0 ? allowed : { ...allowed, droppedFields };
}
