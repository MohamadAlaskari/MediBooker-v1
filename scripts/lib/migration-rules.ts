/**
 * The rules every migration.sql of the two Prisma schemas follows (ADR 0005 §6.3 and §6.6,
 * docs/architecture/02-api.md §9), checked by scripts/check-migrations.ts:
 *
 * - transaction: the migration starts with BEGIN; SET LOCAL lock_timeout = …; SET LOCAL
 *   statement_timeout = …; and ends with COMMIT; (comments and blank lines aside), and no other
 *   statement starts or ends a transaction. A CONCURRENTLY statement cannot run in a transaction,
 *   so it may instead be the only statement of its migration, with its reviewed exception.
 * - timeout: no lock_timeout above 3s and no statement_timeout above 60s (0, DEFAULT and RESET
 *   turn the timeout off) without an `-- exception: <reason>` comment.
 * - concurrently: no CONCURRENTLY without an `-- exception: <reason>` comment.
 * - contract: every DROP, RENAME and type change (ALTER … TYPE) carries a `-- contract` comment.
 * - literal-role (practice migrations only): a GRANT or REVOKE names its role only as `%I` of
 *   `EXECUTE format('…', app_role())`, because every practice database has its own app role.
 * - syntax: a quote, dollar quote or block comment that is never closed stops the check.
 *
 * A statement carries a comment when the comment stands after the previous statement, inside the
 * statement (also inside a DO block), or after it on its last line.
 */
import { splitStatements, SqlSyntaxError, type SqlStatement } from './sql-statements.ts';

export type MigrationSchema = 'platform' | 'practice';

export type MigrationRule =
  'transaction' | 'timeout' | 'concurrently' | 'contract' | 'literal-role' | 'syntax';

export interface MigrationViolation {
  rule: MigrationRule;
  /** The 1-based line it points at. */
  line: number;
  message: string;
}

const CONTRACT_COMMENT = /^--\s*contract\b/;
const EXCEPTION_COMMENT = /^--\s*exception:\s*\S/;

const COMMIT = /^COMMIT ?;$/i;
const HEADER = [
  /^BEGIN ?;$/i,
  /^SET LOCAL lock_timeout ?(?:=|\bTO\b) ?\S[^;]*;$/i,
  /^SET LOCAL statement_timeout ?(?:=|\bTO\b) ?\S[^;]*;$/i,
];
const OPENS_TRANSACTION = /^(?:BEGIN|START)\b/i;
const CLOSES_TRANSACTION = /^(?:COMMIT|END)\b/i;
const TRANSACTION_CONTROL = /^(?:BEGIN|START|COMMIT|END|ROLLBACK|ABORT)\b|^PREPARE TRANSACTION\b/i;

const HEADER_MESSAGE =
  "the migration must start with BEGIN; SET LOCAL lock_timeout = '3s'; SET LOCAL statement_timeout = '60s'; (ADR 0005 §6.3)";
const FOOTER_MESSAGE = 'the migration must end with COMMIT; (ADR 0005 §6.3)';
const CONTROL_MESSAGE =
  "only the header's BEGIN; and the final COMMIT; may start or end the transaction (ADR 0005 §6.3)";

/** The timeouts of the header, in milliseconds, and how the header writes them. */
const TIMEOUT_LIMITS: Readonly<Record<string, { ms: number; text: string }>> = {
  lock_timeout: { ms: 3_000, text: '3s' },
  statement_timeout: { ms: 60_000, text: '60s' },
};
const TIMEOUT_SETTING =
  /\bSET\s+(?:(?:LOCAL|SESSION)\s+)?(lock_timeout|statement_timeout)\s*(?:=|\bTO\b)\s*('[^']*'|[^\s;']+)/gi;
const TIMEOUT_RESET = /\bRESET\s+(lock_timeout|statement_timeout|ALL)\b/gi;
/** A duration as PostgreSQL reads it; without a unit, these two settings count milliseconds. */
const DURATION = /^(\d+(?:\.\d+)?)\s*(us|ms|s|min|h|d)?$/;
const UNIT_MS: Readonly<Record<string, number>> = {
  us: 0.001,
  ms: 1,
  s: 1_000,
  min: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

const CONCURRENTLY = /\bCONCURRENTLY\b/i;

/** DROP, RENAME, or a type change: ALTER [COLUMN | ATTRIBUTE] <name> [SET DATA] TYPE. */
const CONTRACT_STEP =
  /\bDROP\b|\bRENAME\b|\bALTER\s+(?:(?:COLUMN|ATTRIBUTE)\s+)?(?!(?:COLUMN|ATTRIBUTE)\b)(?:"[^"]*"|[A-Za-z_][\w$]*)\s+(?:SET\s+DATA\s+)?TYPE\b/i;

/** A GRANT or REVOKE command; the GRANT of WITH GRANT OPTION and GRANT OPTION FOR is none. */
const GRANT_OR_REVOKE = /\b(GRANT|REVOKE)\b(?!\s+OPTION\b)/gi;
const FORMAT_CALL_BEFORE = /\bformat\s*\(\s*$/i;
const APP_ROLE_ARGUMENTS_AFTER = /^\s*(?:,\s*app_role\s*\(\s*\)\s*)+\)/i;
/** A privilege (ON …) granted to or revoked from `%I` alone. */
const COMMAND_SHAPE: Readonly<Record<string, RegExp>> = {
  GRANT: /^GRANT\s[\s\S]*?\bON\b[\s\S]*?\bTO\s+%I(?:\s+WITH\s+GRANT\s+OPTION)?\s*$/i,
  REVOKE: /^REVOKE\s[\s\S]*?\bON\b[\s\S]*?\bFROM\s+%I(?:\s+(?:CASCADE|RESTRICT))?\s*$/i,
};
const FOR_ROLE = /\bFOR\s+(?:ROLE|USER)\b/i;

/** The violations of one migration, ordered by line. */
export function checkMigrationSql(sql: string, schema: MigrationSchema): MigrationViolation[] {
  let statements: SqlStatement[];
  try {
    statements = splitStatements(sql);
  } catch (error) {
    if (error instanceof SqlSyntaxError) {
      return [violation('syntax', error.line, `${error.message}: the migration cannot be checked`)];
    }
    throw error;
  }
  const violations = [
    ...transactionViolations(statements),
    ...statements.flatMap((statement) => [
      ...timeoutViolations(statement),
      ...concurrentlyViolations(statement),
      ...contractViolations(statement),
      ...(schema === 'practice' ? literalRoleViolations(statement) : []),
    ]),
  ];
  return violations.sort((first, second) => first.line - second.line);
}

function transactionViolations(statements: SqlStatement[]): MigrationViolation[] {
  const [first] = statements;
  const last = statements.at(-1);
  if (first === undefined || last === undefined) {
    return [violation('transaction', 1, HEADER_MESSAGE)];
  }
  if (isLoneExceptionalConcurrently(statements)) {
    return [];
  }
  const violations: MigrationViolation[] = [];
  const mismatch = HEADER.findIndex((pattern, index) => {
    const statement = statements[index];
    return statement === undefined || !pattern.test(normalized(statement));
  });
  if (mismatch !== -1) {
    const line = statements[mismatch]?.startLine ?? last.endLine;
    violations.push(violation('transaction', line, HEADER_MESSAGE));
  }
  const hasEnd = statements.length > 1;
  if (!hasEnd || !COMMIT.test(normalized(last))) {
    violations.push(violation('transaction', last.endLine, FOOTER_MESSAGE));
  }
  // The first and the last statement are judged as the header and the end above.
  const inner = statements.slice(
    OPENS_TRANSACTION.test(normalized(first)) ? 1 : 0,
    hasEnd && CLOSES_TRANSACTION.test(normalized(last)) ? -1 : undefined,
  );
  for (const statement of inner) {
    if (TRANSACTION_CONTROL.test(normalized(statement))) {
      violations.push(violation('transaction', statement.startLine, CONTROL_MESSAGE));
    }
  }
  return violations;
}

/** A migration of one CONCURRENTLY statement with its exception, run outside a transaction. */
function isLoneExceptionalConcurrently(statements: SqlStatement[]): boolean {
  const [only] = statements;
  return (
    statements.length === 1 &&
    only !== undefined &&
    CONCURRENTLY.test(only.code) &&
    carries(only, EXCEPTION_COMMENT)
  );
}

function timeoutViolations(statement: SqlStatement): MigrationViolation[] {
  if (carries(statement, EXCEPTION_COMMENT)) {
    return [];
  }
  const settings = [...statement.code.matchAll(TIMEOUT_SETTING)].flatMap((match) => {
    const setting = (match[1] ?? '').toLowerCase();
    const value = match[2] ?? '';
    const limit = TIMEOUT_LIMITS[setting];
    const ms = durationMs(value);
    if (limit === undefined || (ms !== undefined && ms >= 1 && ms <= limit.ms)) {
      return [];
    }
    return [
      violation(
        'timeout',
        lineAt(statement, match.index),
        `${setting} ${value} is above ${limit.text} or turns the timeout off; that needs an "-- exception: <reason>" comment (ADR 0005 §6.3)`,
      ),
    ];
  });
  const resets = [...statement.code.matchAll(TIMEOUT_RESET)].map((match) =>
    violation(
      'timeout',
      lineAt(statement, match.index),
      `RESET ${match[1] ?? ''} turns the timeout off; that needs an "-- exception: <reason>" comment (ADR 0005 §6.3)`,
    ),
  );
  return [...settings, ...resets];
}

/** The duration in milliseconds, or undefined when the value is none (such as DEFAULT). */
function durationMs(value: string): number | undefined {
  const quoted = value.length >= 2 && value.startsWith("'") && value.endsWith("'");
  const match = DURATION.exec(quoted ? value.slice(1, -1).trim() : value);
  if (match === null) {
    return undefined;
  }
  return Number(match[1]) * (UNIT_MS[match[2] ?? 'ms'] ?? 1);
}

function concurrentlyViolations(statement: SqlStatement): MigrationViolation[] {
  const match = CONCURRENTLY.exec(statement.code);
  if (match === null || carries(statement, EXCEPTION_COMMENT)) {
    return [];
  }
  return [
    violation(
      'concurrently',
      lineAt(statement, match.index),
      'CONCURRENTLY needs an "-- exception: <reason>" comment; a statement that cannot run in a transaction is the only statement of its migration (ADR 0005 §6.3)',
    ),
  ];
}

function contractViolations(statement: SqlStatement): MigrationViolation[] {
  const match = CONTRACT_STEP.exec(statement.code);
  if (match === null || carries(statement, CONTRACT_COMMENT)) {
    return [];
  }
  const keyword = match[0].toUpperCase();
  const step =
    keyword === 'DROP' || keyword === 'RENAME' ? keyword : 'a type change (ALTER … TYPE)';
  return [
    violation(
      'contract',
      lineAt(statement, match.index),
      `${step} needs a "-- contract" comment: a contract step ships one release after the code stopped using the object (ADR 0005 §6.6)`,
    ),
  ];
}

function literalRoleViolations(statement: SqlStatement): MigrationViolation[] {
  return [...statement.code.matchAll(GRANT_OR_REVOKE)].flatMap((match) => {
    const keyword = (match[1] ?? '').toUpperCase();
    if (isAppRoleCommand(statement, match.index, keyword)) {
      return [];
    }
    const form =
      keyword === 'GRANT'
        ? "EXECUTE format('GRANT … ON … TO %I', app_role())"
        : "EXECUTE format('REVOKE … ON … FROM %I', app_role())";
    return [
      violation(
        'literal-role',
        lineAt(statement, match.index),
        `${keyword} in a practice migration names its role only as ${form}: every practice database has its own app role (02 §9)`,
      ),
    ];
  });
}

/**
 * Whether the GRANT or REVOKE at `index` is the format string of `format('…', app_role())` and
 * grants or revokes a privilege to or from `%I` alone.
 */
function isAppRoleCommand(statement: SqlStatement, index: number, keyword: string): boolean {
  const literal = statement.strings.find(({ start, end }) => start < index && index < end);
  const shape = COMMAND_SHAPE[keyword];
  if (literal === undefined || shape === undefined) {
    return false;
  }
  const { code } = statement;
  const content = code.slice(literal.start + 1, literal.end);
  const commandStart = index - literal.start - 1;
  return (
    FORMAT_CALL_BEFORE.test(code.slice(0, literal.start)) &&
    APP_ROLE_ARGUMENTS_AFTER.test(code.slice(literal.end + 1)) &&
    shape.test(content.slice(commandStart)) &&
    !FOR_ROLE.test(content.slice(0, commandStart))
  );
}

function carries(statement: SqlStatement, comment: RegExp): boolean {
  return statement.comments.some(({ text }) => comment.test(text));
}

/** The statement's code on one line, with runs of whitespace as one space. */
function normalized(statement: SqlStatement): string {
  return statement.code.trim().replace(/\s+/g, ' ');
}

/** The 1-based line of an offset in the statement's code. */
function lineAt(statement: SqlStatement, index: number): number {
  return statement.startLine + (statement.code.slice(0, index).match(/\n/g)?.length ?? 0);
}

function violation(rule: MigrationRule, line: number, message: string): MigrationViolation {
  return { rule, line, message };
}
