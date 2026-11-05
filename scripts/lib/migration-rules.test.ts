import { describe, expect, it } from 'vitest';
import { checkMigrationSql, type MigrationSchema } from './migration-rules.ts';

const HEADER = "BEGIN;\nSET LOCAL lock_timeout = '3s';\nSET LOCAL statement_timeout = '60s';\n";

/** A migration with the header, the body lines (from line 4 on) and the final COMMIT. */
function migration(...body: string[]): string {
  return `${HEADER}${body.join('\n')}\nCOMMIT;\n`;
}

/** The rule and line of each violation. */
function found(sql: string, schema: MigrationSchema = 'platform'): [string, number][] {
  return checkMigrationSql(sql, schema).map(({ rule, line }) => [rule, line]);
}

/** The first practice migration as 02 §9 writes it. */
const APP_ROLE_GRANTS = migration(
  'CREATE FUNCTION app_role() RETURNS name LANGUAGE sql STABLE',
  "  AS $$ SELECT nullif(current_setting('medibooker.app_role', true), '')::name $$;",
  'DO $$ BEGIN',
  '  IF app_role() IS NOT NULL THEN',
  "    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', app_role());",
  "    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I', app_role());",
  '  END IF;',
  'END $$;',
  'CREATE TABLE "practice_identity" ("id" SMALLINT NOT NULL DEFAULT 1);',
  'DO $$ BEGIN',
  '  IF app_role() IS NOT NULL THEN',
  "    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON practice_identity FROM %I', app_role());",
  '  END IF;',
  'END $$;',
);

describe('checkMigrationSql accepts', () => {
  it('the first practice migration of 02 §9', () => {
    expect(found(APP_ROLE_GRANTS, 'practice')).toEqual([]);
  });

  it('comments and blank lines around the header and after COMMIT', () => {
    const sql = `-- F04: the registry.\n\n${HEADER}\n-- CreateTable\nCREATE TABLE "a" ("id" INT);\n\nCOMMIT;\n\n-- end\n`;
    expect(found(sql)).toEqual([]);
  });

  it('the header with TO, other spacing, lower case and shorter timeouts', () => {
    const sql =
      "begin ;\nSET  LOCAL lock_timeout TO 1000;\nSET LOCAL statement_timeout='30s';\ncommit;";
    expect(found(sql)).toEqual([]);
  });
});

describe('transaction', () => {
  it('fails a migration without the header and COMMIT (as Prisma writes it)', () => {
    const sql = '-- CreateTable\nCREATE TABLE "a" (\n  "id" INT\n);\n';
    expect(found(sql)).toEqual([
      ['transaction', 2],
      ['transaction', 4],
    ]);
  });

  it('fails an empty migration at line 1', () => {
    expect(found('-- This is an empty migration.\n')).toEqual([['transaction', 1]]);
  });

  it.each([
    [
      'without statement_timeout',
      "BEGIN;\nSET LOCAL lock_timeout = '3s';\nCREATE TABLE a (id int);\nCOMMIT;",
      3,
    ],
    [
      'with the timeouts swapped',
      "BEGIN;\nSET LOCAL statement_timeout = '60s';\nSET LOCAL lock_timeout = '3s';\nCOMMIT;",
      2,
    ],
    ['with BEGIN TRANSACTION', `BEGIN TRANSACTION;\n${HEADER.slice(7)}COMMIT;`, 1],
    ['with a session-level timeout', `${HEADER.replace('LOCAL lock', 'lock')}COMMIT;`, 2],
  ])('fails a header %s at the first statement that differs', (_case, sql, line) => {
    expect(found(sql)).toEqual([['transaction', line]]);
  });

  it.each([
    ['without COMMIT', `${HEADER}CREATE TABLE a (id int);\n`, 4],
    ['with END instead of COMMIT', `${HEADER}CREATE TABLE a (id int);\nEND;\n`, 5],
    ['of the header only', HEADER, 3],
  ])('fails a migration %s at its last line', (_case, sql, line) => {
    expect(found(sql)).toEqual([['transaction', line]]);
  });

  it.each([
    'COMMIT;',
    'END;',
    'BEGIN;',
    'START TRANSACTION;',
    'ROLLBACK;',
    'ROLLBACK TO SAVEPOINT a;',
    'ABORT;',
    "PREPARE TRANSACTION 'a';",
  ])('fails %s between the header and the final COMMIT', (statement) => {
    expect(
      found(migration('CREATE TABLE a (id int);', statement, 'DROP TABLE b; -- contract')),
    ).toEqual([['transaction', 5]]);
  });

  it('fails the inner BEGIN and COMMIT that Prisma writes around an enum change', () => {
    const sql = migration(
      '-- AlterEnum',
      'BEGIN;',
      '-- contract: the code stopped using B in 2026-12',
      'ALTER TYPE "role" RENAME TO "role_old";',
      'COMMIT;',
    );
    expect(found(sql)).toEqual([
      ['transaction', 5],
      ['transaction', 8],
    ]);
  });

  it('passes savepoints and the BEGIN and END of a DO block', () => {
    const sql = migration('SAVEPOINT a;', 'RELEASE SAVEPOINT a;', 'DO $$ BEGIN PERFORM 1; END $$;');
    expect(found(sql)).toEqual([]);
  });

  it('passes a lone CONCURRENTLY statement with its exception outside a transaction', () => {
    const sql =
      '-- exception: builds the index without blocking writes (reviewed)\nCREATE INDEX CONCURRENTLY "a_b_idx" ON "a"("b");\n';
    expect(found(sql)).toEqual([]);
  });

  it('fails a lone CONCURRENTLY statement without its exception', () => {
    const sql = 'CREATE INDEX CONCURRENTLY "a_b_idx" ON "a"("b");\n';
    expect(found(sql)).toEqual([
      ['transaction', 1],
      ['transaction', 1],
      ['concurrently', 1],
    ]);
  });
});

describe('timeout', () => {
  it.each([
    ["'3s'", true],
    ["'3000ms'", true],
    ['3000', true],
    ["'1.5s'", true],
    ["'2 s'", true],
    ["'4s'", false],
    ["'1min'", false],
    ['3001', false],
    ['0', false],
    ["'0'", false],
    ["'0.5ms'", false],
    ["'abc'", false],
  ])('lock_timeout = %s is within 3s: %s', (value, allowed) => {
    const sql = migration(`SET LOCAL lock_timeout = ${value};`);
    expect(found(sql)).toEqual(allowed ? [] : [['timeout', 4]]);
  });

  it.each([
    ["'1min'", true],
    ['60000', true],
    ["'60001ms'", false],
    ["'2min'", false],
    ["'1h'", false],
    ["'1d'", false],
    ['DEFAULT', false],
  ])('statement_timeout TO %s is within 60s: %s', (value, allowed) => {
    const sql = migration(`SET statement_timeout TO ${value};`);
    expect(found(sql)).toEqual(allowed ? [] : [['timeout', 4]]);
  });

  it('fails a larger timeout in the header, in SET SESSION and inside a DO block', () => {
    const sql = [
      'BEGIN;',
      "SET LOCAL lock_timeout = '10s';",
      "SET LOCAL statement_timeout = '60s';",
      "SET SESSION statement_timeout = '5min';",
      'DO $$ BEGIN',
      "  SET LOCAL lock_timeout = '1h';",
      'END $$;',
      'COMMIT;',
    ].join('\n');
    expect(found(sql)).toEqual([
      ['timeout', 2],
      ['timeout', 4],
      ['timeout', 6],
    ]);
  });

  it.each(['RESET statement_timeout;', 'RESET lock_timeout;', 'RESET ALL;'])(
    'fails %s, which turns the timeout off',
    (statement) => {
      expect(found(migration(statement))).toEqual([['timeout', 4]]);
    },
  );

  it('passes a larger timeout or a RESET with an exception comment', () => {
    const sql = [
      'BEGIN;',
      "SET LOCAL lock_timeout = '3s';",
      '-- exception: backfills every appointment once (reviewed in P04)',
      "SET LOCAL statement_timeout = '15min';",
      "UPDATE a SET b = 'c';",
      'RESET lock_timeout; -- exception: the backfill waits for the nightly job',
      'COMMIT;',
    ].join('\n');
    expect(found(sql)).toEqual([]);
  });

  it('needs a reason after "exception:"', () => {
    const sql = migration('-- exception:', "SET LOCAL statement_timeout = '2min';");
    expect(found(sql)).toEqual([['timeout', 5]]);
  });
});

describe('concurrently', () => {
  it('fails CONCURRENTLY without an exception comment, at its line', () => {
    const sql = migration('REFRESH MATERIALIZED VIEW', '  CONCURRENTLY "a";');
    expect(found(sql)).toEqual([['concurrently', 5]]);
  });

  it('passes CONCURRENTLY with an exception comment', () => {
    const sql = migration(
      '-- exception: readers keep the old rows during the refresh',
      'REFRESH MATERIALIZED VIEW CONCURRENTLY "a";',
    );
    expect(found(sql)).toEqual([]);
  });
});

describe('contract', () => {
  it.each([
    ['ALTER TABLE "a" DROP COLUMN "b";'],
    ['DROP INDEX "a_b_idx";'],
    ['DROP TYPE IF EXISTS "role_old";'],
    ['ALTER TABLE "a" ALTER COLUMN "b" DROP NOT NULL;'],
    ['ALTER TABLE "a" RENAME COLUMN "b" TO "c";'],
    ['ALTER INDEX "a_b_idx" RENAME TO "a_c_idx";'],
    ['ALTER TABLE "a" ALTER COLUMN "b" TYPE TEXT;'],
    ['ALTER TABLE "a" ALTER COLUMN "b" SET DATA TYPE BIGINT USING "b"::bigint;'],
    ['ALTER TABLE a ALTER b TYPE text;'],
    ['ALTER TYPE "t" ALTER ATTRIBUTE "x" TYPE int;'],
    ["DO $$ BEGIN EXECUTE 'DROP TABLE old_rows'; END $$;"],
  ])('fails %s without a -- contract comment and passes it with one', (statement) => {
    expect(found(migration('-- AlterTable', statement))).toEqual([['contract', 5]]);
    expect(found(migration('-- contract: unused since release 2026.12', statement))).toEqual([]);
  });

  it('reports the line of the keyword in a statement of several lines', () => {
    const sql = migration('ALTER TABLE "a"', '  ADD COLUMN "c" INT,', '  DROP COLUMN "b";');
    expect(found(sql)).toEqual([['contract', 6]]);
  });

  it.each([
    ['on the line after the statement', 'DROP TABLE "a"; -- contract'],
    ['inside the statement', 'ALTER TABLE "a"\n  -- contract\n  DROP COLUMN "b";'],
    ['above it, after a blank line', '--contract: unused\n\nDROP TABLE "a";'],
    ['inside a DO block', "DO $$ BEGIN\n  -- contract\n  EXECUTE 'DROP TABLE a';\nEND $$;"],
  ])('passes a -- contract comment %s', (_place, body) => {
    expect(found(migration(body))).toEqual([]);
  });

  it.each([
    [
      'above the previous statement',
      '-- contract\nCREATE TABLE "b" ("id" INT);\nDROP TABLE "a";',
      6,
    ],
    ['in other words', '-- Contract step\nDROP TABLE "a";', 5],
    ['as a block comment', '/* contract */\nDROP TABLE "a";', 5],
  ])('fails a comment %s', (_place, body, line) => {
    expect(found(migration(body))).toEqual([['contract', line]]);
  });

  it('passes statements that only look like contract steps', () => {
    const sql = migration(
      '-- DropIndex: DROP and RENAME in comments do not count',
      "CREATE TYPE \"role\" AS ENUM ('ADMIN', 'STAFF');",
      'ALTER TYPE "role" ADD VALUE \'DOCTOR\';',
      'CREATE TABLE "type" ("drop" TEXT, "rename" TEXT, "type" TEXT);',
      'ALTER TABLE "type" ADD COLUMN "dropped_at" TIMESTAMPTZ(3);',
      'ALTER TABLE "type" ALTER COLUMN "type" SET DEFAULT \'x\';',
      'ALTER TABLE "type" ALTER type SET NOT NULL;',
      'ALTER TABLE "a" ADD CONSTRAINT "a_b_fkey" FOREIGN KEY ("b") REFERENCES "b"("id") ON DELETE RESTRICT;',
    );
    expect(found(sql)).toEqual([]);
  });
});

describe('literal-role', () => {
  it.each([
    ['a plain GRANT', 'GRANT SELECT ON t TO practice_0a1b_app;'],
    ['a plain REVOKE from PUBLIC', 'REVOKE ALL ON FUNCTION app_role() FROM PUBLIC;'],
    [
      'plain default privileges',
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO platform_app;',
    ],
    [
      'a role in the format string',
      "EXECUTE format('GRANT SELECT ON t TO practice_x', app_role());",
    ],
    ['%s instead of %I', "EXECUTE format('GRANT SELECT ON t TO %s', app_role());"],
    ['another argument', "EXECUTE format('GRANT SELECT ON t TO %I', 'practice_x');"],
    ['an E string', "EXECUTE format(E'GRANT SELECT ON t TO %I', app_role());"],
    ['a second role', "EXECUTE format('GRANT SELECT ON t TO %I, practice_y', app_role());"],
    ['a role membership', "EXECUTE format('GRANT %I TO %I', app_role(), app_role());"],
    ['GRANTED BY', "EXECUTE format('GRANT SELECT ON t TO %I GRANTED BY practice_x', app_role());"],
    [
      'FOR ROLE',
      "EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE practice_x IN SCHEMA public GRANT SELECT ON TABLES TO %I', app_role());",
    ],
    ['string concatenation', "EXECUTE 'GRANT SELECT ON t TO ' || quote_ident(app_role());"],
  ])('fails %s in a practice migration and passes it in a platform migration', (_case, line) => {
    const sql = migration(`DO $$ BEGIN`, `  ${line}`, 'END $$;');
    const plain = migration(line);
    const isPlain = !line.startsWith('EXECUTE');
    expect(found(isPlain ? plain : sql, 'practice')).toEqual([['literal-role', isPlain ? 4 : 5]]);
    expect(found(isPlain ? plain : sql, 'platform')).toEqual([]);
  });

  it.each([
    "EXECUTE format('GRANT SELECT ON t TO %I WITH GRANT OPTION', app_role());",
    "EXECUTE format('REVOKE GRANT OPTION FOR SELECT ON t FROM %I CASCADE', app_role());",
    "EXECUTE format( 'grant select on t to %I' , app_role ( ) );",
  ])('passes %s', (line) => {
    expect(found(migration('DO $$ BEGIN', `  ${line}`, 'END $$;'), 'practice')).toEqual([]);
  });

  it('reports each GRANT and REVOKE of a statement at its line', () => {
    const sql = migration(
      'DO $$ BEGIN',
      '  GRANT SELECT ON t TO a;',
      '  REVOKE SELECT ON t FROM b;',
      'END $$;',
    );
    expect(found(sql, 'practice')).toEqual([
      ['literal-role', 5],
      ['literal-role', 6],
    ]);
  });
});

describe('syntax', () => {
  it('reports an unterminated quote at its line and checks nothing else', () => {
    const sql = migration('DROP TABLE "a";', "INSERT INTO b VALUES ('c);");
    expect(checkMigrationSql(sql, 'practice')).toEqual([
      {
        rule: 'syntax',
        line: 5,
        message: 'unterminated quoted string: the migration cannot be checked',
      },
    ]);
  });
});
