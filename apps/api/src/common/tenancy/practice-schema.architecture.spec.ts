import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The one table that names the practice: the database is the boundary for all others (02 §9). */
const EXEMPT = new Set(['PracticeIdentity']);

/** The models of a Prisma schema that declare a `practiceId` field. */
function modelsNamingThePractice(schema: string): string[] {
  const models = [...schema.matchAll(/^model (\w+) \{\n([\s\S]*?)^\}/gm)];
  return models
    .filter(([, name, body]) => {
      return !EXEMPT.has(name ?? '') && /^\s*practiceId\s/m.test(body ?? '');
    })
    .map(([, name]) => name ?? '');
}

describe('the practice schema (02 §9, ADR 0005 §10)', () => {
  it('declares no practiceId: the database is the boundary', () => {
    const schema = readFileSync(
      new URL('../../../prisma/practice/schema.prisma', import.meta.url),
      'utf8',
    );
    expect(schema).toContain('model Service {');
    expect(modelsNamingThePractice(schema)).toEqual([]);
  });

  it('fails for a model with a practiceId field, except practice_identity', () => {
    const schema = [
      'model PracticeIdentity {',
      '  practiceId String @unique',
      '}',
      '',
      'model Leaky {',
      '  id         String @id',
      '  practiceId String @map("practice_id")',
      '}',
      '',
      'model Clean {',
      '  id String @id',
      '}',
      '',
    ].join('\n');
    expect(modelsNamingThePractice(schema)).toEqual(['Leaky']);
  });
});
