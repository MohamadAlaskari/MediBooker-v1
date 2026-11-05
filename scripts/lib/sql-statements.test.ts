import { describe, expect, it } from 'vitest';
import { splitStatements, SqlSyntaxError } from './sql-statements.ts';

/** The code of each statement, with runs of whitespace as one space. */
function codes(sql: string): string[] {
  return splitStatements(sql).map(({ code }) => code.replace(/\s+/g, ' ').trim());
}

describe('splitStatements', () => {
  it('splits at top-level semicolons and records the first and last line of each statement', () => {
    const statements = splitStatements('BEGIN;\nCREATE TABLE a (\n  id int\n);\n\nCOMMIT;\n');
    expect(statements.map(({ startLine, endLine }) => [startLine, endLine])).toEqual([
      [1, 1],
      [2, 4],
      [6, 6],
    ]);
    expect(statements[1]?.code).toBe('CREATE TABLE a (\n  id int\n);');
  });

  it('skips empty statements and keeps text after the last semicolon as a statement', () => {
    expect(codes(';;\nSELECT 1;\n ; \nCOMMIT')).toEqual(['SELECT 1;', 'COMMIT']);
    expect(splitStatements('SELECT 1;\nCOMMIT   \n')[1]).toMatchObject({
      startLine: 2,
      endLine: 2,
    });
    expect(splitStatements('')).toEqual([]);
    expect(splitStatements('-- only a comment\n')).toEqual([]);
  });

  it('counts lines across CRLF line endings', () => {
    const statements = splitStatements('BEGIN;\r\n\r\nSELECT\r\n  1;\r\n');
    expect(statements.map(({ startLine, endLine }) => [startLine, endLine])).toEqual([
      [1, 1],
      [3, 4],
    ]);
  });

  it('keeps semicolons and comment markers inside string literals', () => {
    expect(codes("SELECT 'a;b', 'it''s; -- no comment';\nSELECT 2;")).toEqual([
      "SELECT 'a;b', 'it''s; -- no comment';",
      'SELECT 2;',
    ]);
  });

  it('reads backslash escapes in escape strings only', () => {
    expect(codes("SELECT E'it\\'s; one';\nSELECT e'\\\\';\nSELECT 3;")).toHaveLength(3);
    // In a standard string a backslash is a plain character, so the quote after it ends it.
    expect(codes("SELECT 'C:\\';\nSELECT 4;")).toEqual(["SELECT 'C:\\';", 'SELECT 4;']);
    // An E at the end of an identifier is no prefix.
    expect(codes("SELECT name'\\';\nSELECT 5;")).toEqual(["SELECT name'\\';", 'SELECT 5;']);
  });

  it('masks the content of quoted identifiers, also with an escaped quote and a semicolon', () => {
    const [statement] = splitStatements('ALTER TABLE "drop;" RENAME TO "say ""hi""";');
    expect(statement?.code).toBe('ALTER TABLE "     " RENAME TO "          ";');
  });

  it('masks line and nested block comments and records them with their first line', () => {
    const [first, second] = splitStatements(
      '-- DROP nothing; here\nSELECT /* a /* nested; */\n still; */ 1;\nSELECT 2; -- trailing',
    );
    expect(first?.code.replace(/\s+/g, ' ')).toBe('SELECT 1;');
    expect(first?.startLine).toBe(2);
    expect(first?.comments).toEqual([
      { text: '-- DROP nothing; here', line: 1 },
      { text: '/* a /* nested; */\n still; */', line: 2 },
    ]);
    expect(second?.comments).toEqual([{ text: '-- trailing', line: 4 }]);
  });

  it('gives a comment to the statement it follows on the same line, others to the next one', () => {
    const statements = splitStatements(
      'A; -- after A\n-- before B\nB -- inside B\n;\nC; D; -- after D\n-- after everything\n',
    );
    expect(statements.map(({ comments }) => comments.map(({ text }) => text))).toEqual([
      ['-- after A'],
      ['-- before B', '-- inside B'],
      [],
      ['-- after D'],
    ]);
  });

  it('gives a trailing comment to a last statement without a semicolon', () => {
    const [statement] = splitStatements('COMMIT -- done\n');
    expect(statement?.code).toBe('COMMIT');
    expect(statement?.comments).toEqual([{ text: '-- done', line: 1 }]);
  });

  it('keeps dollar-quoted bodies in one statement, masking their comments', () => {
    const sql = [
      'DO $$ BEGIN',
      "  -- a comment; with 'quotes",
      "  EXECUTE format('GRANT SELECT ON t TO %I', app_role());",
      'END $$;',
      'CREATE FUNCTION f() RETURNS int LANGUAGE sql AS $fn$ SELECT $$;$$::int $fn$;',
      'SELECT 3;',
    ].join('\n');
    const statements = splitStatements(sql);
    expect(statements).toHaveLength(3);
    expect(statements[0]?.code).not.toContain('a comment');
    expect(statements[0]?.comments).toEqual([{ text: "-- a comment; with 'quotes", line: 2 }]);
    expect(statements[1]?.code).toContain('$fn$ SELECT $$;$$::int $fn$');
  });

  it('records string literals by the offsets of their quotes, also inside bodies', () => {
    const [statement] = splitStatements("DO $$ BEGIN EXECUTE format('x''y', 'z'); END $$;");
    const code = statement?.code ?? '';
    expect(statement?.strings.map(({ start, end }) => code.slice(start, end + 1))).toEqual([
      "'x''y'",
      "'z'",
    ]);
  });

  it('reads $1 and a $ inside an identifier as no dollar quote', () => {
    expect(codes('SELECT $1; SELECT a$b$; SELECT 3;')).toEqual([
      'SELECT $1;',
      'SELECT a$b$;',
      'SELECT 3;',
    ]);
  });

  it.each([
    ['a string literal', "SELECT 1;\nSELECT 'abc;\n", 'unterminated quoted string', 2],
    ['an escape string', "SELECT E'abc\\';\n", 'unterminated quoted string', 1],
    ['a quoted identifier', 'SELECT 1;\n\nSELECT "abc;\n', 'unterminated quoted identifier', 3],
    ['a block comment', 'SELECT 1; /* a /* b */\n', 'unterminated block comment', 1],
    ['a dollar quote', 'SELECT 1;\nDO $x$ BEGIN END $$;\n', 'unterminated dollar-quoted string', 2],
    ['a string inside a body', "DO $$\nBEGIN RAISE 'it''s; $$;\nEND $$;", 'quoted string', 2],
  ])('throws SqlSyntaxError for an unterminated %s', (_construct, sql, message, line) => {
    const error = errorOf(() => splitStatements(sql));
    expect(error).toBeInstanceOf(SqlSyntaxError);
    expect(error).toMatchObject({ name: 'SqlSyntaxError', line });
    expect((error as SqlSyntaxError).message).toContain(message);
  });
});

/** The error that the action throws, or undefined. */
function errorOf(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  return undefined;
}
