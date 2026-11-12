import type { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import type { PlatformPrismaService } from '../../common/database/platform-prisma.service.js';
import type { PracticeRunner } from '../../common/tenancy/practice-runner.js';
import type { PracticeTransactionHost } from '../../common/tenancy/practice-transactional.adapter.js';
import type { Env } from '../../config/env.schema.js';
import { canWrite, InstallationPractice, WRITING_FALLBACK } from './installation-practice.js';

const NAME = { ar: 'مركز النور الطبي', en: 'Al Noor Medical Centre' };
const PRACTICE_ID = '00000000-0000-4000-8000-000000000001';
const RIYADH = { timeZone: 'Asia/Riyadh', numberingSystem: 'arab', hourCycle: 'h12' };

function practiceWith(
  slug: string | undefined,
  name: unknown,
  settings: () => Promise<unknown> = () => Promise.resolve(RIYADH),
): { practice: InstallationPractice; warn: ReturnType<typeof vi.fn> } {
  const findUnique = vi
    .fn()
    .mockResolvedValue(name === null ? null : { practiceId: PRACTICE_ID, practice: { name } });
  const platform = { practiceSlug: { findUnique } } as unknown as PlatformPrismaService;
  const runner = {
    runInPractice: vi.fn((practiceId: string, work: () => Promise<unknown>) =>
      practiceId === PRACTICE_ID ? work() : Promise.reject(new Error('wrong practice')),
    ),
  } as unknown as PracticeRunner;
  const practiceTx = {
    tx: { practiceSettings: { findUniqueOrThrow: vi.fn(settings) } },
  } as unknown as PracticeTransactionHost;
  const warn = vi.fn();
  const logger = { setContext: vi.fn(), warn } as unknown as PinoLogger;
  return {
    practice: new InstallationPractice(
      platform,
      { PRACTICE_SLUG: slug } as Env,
      runner,
      practiceTx,
      logger,
    ),
    warn,
  };
}

describe('InstallationPractice (ADR 0016)', () => {
  it('names the practice in the language asked for', async () => {
    const { practice } = practiceWith('al-noor', NAME);
    await expect(practice.nameIn('en')).resolves.toBe('Al Noor Medical Centre');
    await expect(practice.nameIn('ar')).resolves.toBe('مركز النور الطبي');
  });

  it('falls back to its other language, also for a language it does not know', async () => {
    await expect(practiceWith('al-noor', { ar: NAME.ar }).practice.nameIn('en')).resolves.toBe(
      NAME.ar,
    );
    await expect(practiceWith('al-noor', { en: NAME.en }).practice.nameIn('ar')).resolves.toBe(
      NAME.en,
    );
    await expect(practiceWith('al-noor', NAME).practice.nameIn('xx')).resolves.toBe(NAME.ar);
  });

  it('names none without a practice of the installation, an unknown slug or a name', async () => {
    await expect(practiceWith(undefined, NAME).practice.nameIn('en')).resolves.toBeUndefined();
    await expect(practiceWith('al-noor', null).practice.nameIn('en')).resolves.toBeUndefined();
    await expect(practiceWith('al-noor', {}).practice.nameIn('en')).resolves.toBeUndefined();
  });

  it('writes a time as the practice does, from its own database (A04)', async () => {
    await expect(practiceWith('al-noor', NAME).practice.writing()).resolves.toEqual(RIYADH);
  });

  it('writes in UTC with Latin digits where it names no practice or cannot reach it', async () => {
    await expect(practiceWith(undefined, NAME).practice.writing()).resolves.toEqual(
      WRITING_FALLBACK,
    );
    await expect(practiceWith('al-noor', null).practice.writing()).resolves.toEqual(
      WRITING_FALLBACK,
    );
    const { practice, warn } = practiceWith('al-noor', NAME, () =>
      Promise.reject(new Error('down')),
    );
    await expect(practice.writing()).resolves.toEqual(WRITING_FALLBACK);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('writes in UTC where the settings name a zone or digits no formatter takes', async () => {
    for (const broken of [
      { ...RIYADH, timeZone: 'Mars/Olympus_Mons' },
      { ...RIYADH, numberingSystem: 'x!' },
    ]) {
      const { practice, warn } = practiceWith('al-noor', NAME, () => Promise.resolve(broken));
      await expect(practice.writing()).resolves.toEqual(WRITING_FALLBACK);
      expect(warn).toHaveBeenCalledTimes(1);
    }
    expect(canWrite(RIYADH)).toBe(true);
    expect(canWrite(WRITING_FALLBACK)).toBe(true);
  });
});
