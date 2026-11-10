import { describe, expect, it, vi } from 'vitest';
import type { PlatformPrismaService } from '../../common/database/platform-prisma.service.js';
import type { Env } from '../../config/env.schema.js';
import { InstallationPractice } from './installation-practice.js';

const NAME = { ar: 'مركز النور الطبي', en: 'Al Noor Medical Centre' };

function practiceWith(slug: string | undefined, name: unknown): InstallationPractice {
  const findUnique = vi.fn().mockResolvedValue(name === null ? null : { practice: { name } });
  const platform = { practiceSlug: { findUnique } } as unknown as PlatformPrismaService;
  return new InstallationPractice(platform, { PRACTICE_SLUG: slug } as Env);
}

describe('InstallationPractice (ADR 0016)', () => {
  it('names the practice in the language asked for', async () => {
    const practice = practiceWith('al-noor', NAME);
    await expect(practice.nameIn('en')).resolves.toBe('Al Noor Medical Centre');
    await expect(practice.nameIn('ar')).resolves.toBe('مركز النور الطبي');
  });

  it('falls back to its other language, also for a language it does not know', async () => {
    await expect(practiceWith('al-noor', { ar: NAME.ar }).nameIn('en')).resolves.toBe(NAME.ar);
    await expect(practiceWith('al-noor', { en: NAME.en }).nameIn('ar')).resolves.toBe(NAME.en);
    await expect(practiceWith('al-noor', NAME).nameIn('xx')).resolves.toBe(NAME.ar);
  });

  it('names none without a practice of the installation, an unknown slug or a name', async () => {
    await expect(practiceWith(undefined, NAME).nameIn('en')).resolves.toBeUndefined();
    await expect(practiceWith('al-noor', null).nameIn('en')).resolves.toBeUndefined();
    await expect(practiceWith('al-noor', {}).nameIn('en')).resolves.toBeUndefined();
  });
});
