/**
 * Splits a PostgreSQL script into its top-level statements the way the server reads it: a
 * semicolon ends a statement only outside comments, quoted strings, quoted identifiers and
 * dollar-quoted bodies. scripts/check-migrations.ts reads every migration through it, so its rules
 * never match a word in a comment or in an identifier.
 */

export interface SqlComment {
  /** The comment as written: from `--` to the end of its line, or from `/*` to its `*\/`. */
  text: string;
  /** The 1-based line on which it starts. */
  line: number;
}

/** A string literal of a statement, by the offsets of its quotes in the statement's code. */
export interface SqlStringLiteral {
  /** The offset of the opening quote. */
  start: number;
  /** The offset of the closing quote. */
  end: number;
}

export interface SqlStatement {
  /**
   * The statement from its first character to its terminating semicolon. Every comment and the
   * content of every quoted identifier are replaced by spaces (line breaks stay), so a word found
   * here is code. String literals and dollar-quoted bodies stay as written: a DO block runs SQL
   * from them.
   */
  code: string;
  /** The 1-based line of the statement's first character. */
  startLine: number;
  /** The 1-based line of its terminating semicolon (or of its last character without one). */
  endLine: number;
  /** The comments after the previous statement, inside this one, and after it on its last line. */
  comments: SqlComment[];
  /** Its string literals, also those inside dollar-quoted bodies. */
  strings: SqlStringLiteral[];
}

/** A quote, a dollar quote or a block comment that is never closed. */
export class SqlSyntaxError extends Error {
  /** The 1-based line on which the unterminated construct starts. */
  readonly line: number;

  constructor(message: string, line: number) {
    super(message);
    this.name = 'SqlSyntaxError';
    this.line = line;
  }
}

/** A dollar-quote delimiter: `$$` or `$tag$`, where the tag does not start with a digit. */
const DOLLAR_QUOTE = /\$(?:[A-Za-z_\u0080-￿][\w\u0080-￿]*)?\$/y;

/** A character that may continue an identifier (PostgreSQL also allows `$` after the first). */
const IDENTIFIER_CHAR = /^[\w$\u0080-￿]$/;

interface LexedComment {
  text: string;
  offset: number;
}

interface LexState {
  sql: string;
  /** The script, with comments and quoted-identifier contents replaced by spaces. */
  masked: string[];
  /** The offsets of the semicolons that end top-level statements. */
  terminators: number[];
  comments: LexedComment[];
  strings: SqlStringLiteral[];
  lineStarts: number[];
}

/**
 * The statements of the script, in order. Empty statements (a lone semicolon) are skipped; text
 * after the last semicolon is a statement of its own. Throws SqlSyntaxError for a quote, dollar
 * quote or block comment that is never closed, also inside a dollar-quoted body.
 */
export function splitStatements(sql: string): SqlStatement[] {
  const state: LexState = {
    sql,
    masked: sql.split(''),
    terminators: [],
    comments: [],
    strings: [],
    lineStarts: lineStartsOf(sql),
  };
  lexRange(state, 0, sql.length, true);
  const masked = state.masked.join('');
  const statements = statementSpans(masked, state.terminators).map(({ start, end }) => ({
    code: masked.slice(start, end + 1),
    start,
    end,
    startLine: lineOf(state, start),
    endLine: lineOf(state, end),
    comments: [] as SqlComment[],
    strings: state.strings
      .filter((literal) => literal.start >= start && literal.end <= end)
      .map((literal) => ({ start: literal.start - start, end: literal.end - start })),
  }));
  attachComments(state, statements);
  return statements.map(({ code, startLine, endLine, comments, strings }) => ({
    code,
    startLine,
    endLine,
    comments,
    strings,
  }));
}

/** Lexes sql[start, end); only the top level splits statements at semicolons. */
function lexRange(state: LexState, start: number, end: number, topLevel: boolean): void {
  const { sql } = state;
  let index = start;
  while (index < end) {
    const char = sql[index];
    const next = index + 1 < end ? sql[index + 1] : undefined;
    if (char === '-' && next === '-') {
      index = skipLineComment(state, index, end);
    } else if (char === '/' && next === '*') {
      index = skipBlockComment(state, index, end);
    } else if (char === "'") {
      index = skipStringLiteral(state, index, end);
    } else if (char === '"') {
      index = skipQuotedIdentifier(state, index, end);
    } else if (char === '$' && !IDENTIFIER_CHAR.test(sql[index - 1] ?? ' ')) {
      index = skipDollarQuoted(state, index, end) ?? index + 1;
    } else {
      if (char === ';' && topLevel) {
        state.terminators.push(index);
      }
      index += 1;
    }
  }
}

function skipLineComment(state: LexState, start: number, end: number): number {
  const newline = state.sql.indexOf('\n', start);
  const commentEnd = newline === -1 || newline > end ? end : newline;
  recordComment(state, start, commentEnd);
  return commentEnd;
}

/** Block comments nest in PostgreSQL. */
function skipBlockComment(state: LexState, start: number, end: number): number {
  const { sql } = state;
  let depth = 0;
  let index = start;
  while (index < end) {
    if (sql.startsWith('/*', index)) {
      depth += 1;
      index += 2;
    } else if (sql.startsWith('*/', index)) {
      depth -= 1;
      index += 2;
      if (depth === 0) {
        recordComment(state, start, index);
        return index;
      }
    } else {
      index += 1;
    }
  }
  throw new SqlSyntaxError('unterminated block comment', lineOf(state, start));
}

/**
 * A string literal; `''` is a quote inside it. After an `E` prefix (an escape string), a
 * backslash also escapes the next character.
 */
function skipStringLiteral(state: LexState, start: number, end: number): number {
  const { sql } = state;
  const prefix = sql[start - 1];
  const escapes =
    (prefix === 'E' || prefix === 'e') && !IDENTIFIER_CHAR.test(sql[start - 2] ?? ' ');
  let index = start + 1;
  while (index < end) {
    const char = sql[index];
    if (escapes && char === '\\') {
      index += 2;
    } else if (char === "'" && index + 1 < end && sql[index + 1] === "'") {
      index += 2;
    } else if (char === "'") {
      state.strings.push({ start, end: index });
      return index + 1;
    } else {
      index += 1;
    }
  }
  throw new SqlSyntaxError('unterminated quoted string', lineOf(state, start));
}

/** A quoted identifier; `""` is a quote inside it. Its content is masked. */
function skipQuotedIdentifier(state: LexState, start: number, end: number): number {
  const { sql } = state;
  let index = start + 1;
  while (index < end) {
    if (sql[index] === '"' && index + 1 < end && sql[index + 1] === '"') {
      index += 2;
    } else if (sql[index] === '"') {
      mask(state, start + 1, index);
      return index + 1;
    } else {
      index += 1;
    }
  }
  throw new SqlSyntaxError('unterminated quoted identifier', lineOf(state, start));
}

/**
 * A dollar-quoted body, or undefined when the `$` opens none (a parameter such as `$1`). The body
 * ends at the first repetition of its delimiter, as in PostgreSQL. It is lexed as code, because
 * DO blocks and function bodies are code: its comments are masked and its strings recorded.
 */
function skipDollarQuoted(state: LexState, start: number, end: number): number | undefined {
  DOLLAR_QUOTE.lastIndex = start;
  const delimiter = DOLLAR_QUOTE.exec(state.sql)?.[0];
  if (delimiter === undefined) {
    return undefined;
  }
  const bodyStart = start + delimiter.length;
  const close = state.sql.indexOf(delimiter, bodyStart);
  if (close === -1 || close + delimiter.length > end) {
    throw new SqlSyntaxError('unterminated dollar-quoted string', lineOf(state, start));
  }
  lexRange(state, bodyStart, close, false);
  return close + delimiter.length;
}

function recordComment(state: LexState, start: number, end: number): void {
  state.comments.push({ text: state.sql.slice(start, end), offset: start });
  mask(state, start, end);
}

/** Replaces masked[start, end) by spaces, keeping line breaks. */
function mask(state: LexState, start: number, end: number): void {
  for (let index = start; index < end; index += 1) {
    if (state.masked[index] !== '\n') {
      state.masked[index] = ' ';
    }
  }
}

/** The span of each statement: its first non-blank character to its semicolon (inclusive). */
function statementSpans(masked: string, terminators: number[]): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  let previousEnd = -1;
  for (const terminator of [...terminators, masked.length]) {
    const segment = masked.slice(previousEnd + 1, terminator);
    const leading = segment.length - segment.trimStart().length;
    const trailing = segment.length - segment.trimEnd().length;
    if (segment.trim() !== '') {
      const start = previousEnd + 1 + leading;
      const end = terminator < masked.length ? terminator : masked.length - trailing - 1;
      spans.push({ start, end });
    }
    previousEnd = terminator;
  }
  return spans;
}

/**
 * Gives each comment to the statement it documents: a comment on the line where a statement ends,
 * before the next statement starts, belongs to that statement; any other comment belongs to the
 * next statement that ends after it. Comments after the last statement on later lines belong to
 * none.
 */
function attachComments(
  state: LexState,
  statements: (SqlStatement & { start: number; end: number })[],
): void {
  for (const { text, offset } of state.comments) {
    const line = lineOf(state, offset);
    const next = statements.find((statement) => statement.end > offset);
    const previous = statements.findLast((statement) => statement.end < offset);
    const trailsPrevious =
      previous?.endLine === line && (next === undefined || next.start > offset);
    const owner = trailsPrevious ? previous : next;
    owner?.comments.push({ text, line });
  }
}

function lineStartsOf(sql: string): number[] {
  const starts = [0];
  for (let index = sql.indexOf('\n'); index !== -1; index = sql.indexOf('\n', index + 1)) {
    starts.push(index + 1);
  }
  return starts;
}

/** The 1-based line of an offset. */
function lineOf(state: LexState, offset: number): number {
  let low = 0;
  let high = state.lineStarts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((state.lineStarts[middle] ?? 0) <= offset) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low + 1;
}
