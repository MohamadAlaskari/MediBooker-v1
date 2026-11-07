import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearChoice,
  expireChoice,
  parseChoice,
  readRawChoice,
  saveChoice,
} from './booking-choice';

const SERVICE = '10000000-0000-4000-8000-000000000001';
const DOCTOR = '20000000-0000-4000-8000-000000000001';
const CHOICE = { slug: 'al-noor', serviceId: SERVICE, startsAt: '2026-11-10T06:00:00Z' };
const NOW = Date.UTC(2026, 10, 8, 6);
const MINUTE = 60_000;

/** As stored: with the time of choosing. */
function stored(choice: object, savedAt: unknown = NOW): string {
  return JSON.stringify({ ...choice, savedAt });
}

describe('parseChoice', () => {
  it('reads a choice for this practice, with or without a doctor, and not when it was made', () => {
    expect(parseChoice(stored(CHOICE), 'al-noor', NOW)).toEqual(CHOICE);
    const withDoctor = { ...CHOICE, providerId: DOCTOR };
    expect(parseChoice(stored(withDoctor), 'al-noor', NOW)).toEqual(withDoctor);
  });

  it('takes nothing for another practice', () => {
    expect(parseChoice(stored(CHOICE), 'ocean', NOW)).toBeUndefined();
  });

  it('lasts as long as a sign-in takes: fifteen minutes, and not one more', () => {
    expect(parseChoice(stored(CHOICE), 'al-noor', NOW + 15 * MINUTE)).toEqual(CHOICE);
    expect(parseChoice(stored(CHOICE), 'al-noor', NOW + 15 * MINUTE + 1)).toBeUndefined();
  });

  it.each([
    ['no time of choosing', JSON.stringify(CHOICE)],
    ['a time of choosing that is none', stored(CHOICE, 'yesterday')],
    ['a time of choosing still to come', stored(CHOICE, NOW + 1)],
    ['nothing', null],
    ['no JSON', 'not json'],
    ['no object', '7'],
    ['null', 'null'],
    ['a service that is no id', stored({ ...CHOICE, serviceId: '../x' })],
    ['no service', stored({ slug: 'al-noor', startsAt: CHOICE.startsAt })],
    ['a time that is none', stored({ ...CHOICE, startsAt: 'tomorrow' })],
    ['no time', stored({ slug: 'al-noor', serviceId: SERVICE })],
    ['a doctor that is no id', stored({ ...CHOICE, providerId: 'x' })],
    ['a doctor that is no text', stored({ ...CHOICE, providerId: 7 })],
  ])('takes nothing from %s', (_, raw) => {
    expect(parseChoice(raw, 'al-noor', NOW)).toBeUndefined();
  });
});

describe('the storage of a choice', () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    values.clear();
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps what was chosen with its time, until it is cleared', () => {
    saveChoice(CHOICE);
    expect(parseChoice(readRawChoice(), 'al-noor')).toEqual(CHOICE);
    clearChoice();
    expect(readRawChoice()).toBeNull();
  });

  it('removes it with the page left open, when its fifteen minutes are over', () => {
    saveChoice(CHOICE);
    vi.advanceTimersByTime(15 * MINUTE);
    expect(readRawChoice()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(readRawChoice()).toBeNull();
  });

  it('counts from the newest choice', () => {
    saveChoice(CHOICE);
    vi.advanceTimersByTime(10 * MINUTE);
    saveChoice(CHOICE);
    vi.advanceTimersByTime(14 * MINUTE);
    expect(readRawChoice()).not.toBeNull();
    vi.advanceTimersByTime(MINUTE + 1);
    expect(readRawChoice()).toBeNull();
  });

  it('leaves one of an earlier page only what is left of its minutes', () => {
    saveChoice(CHOICE, NOW - 10 * MINUTE);
    expireChoice();
    expect(readRawChoice()).not.toBeNull();
    vi.advanceTimersByTime(5 * MINUTE);
    expect(readRawChoice()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(readRawChoice()).toBeNull();
  });

  it.each([
    ['one of an earlier page whose minutes are over', stored(CHOICE, NOW - 15 * MINUTE - 1)],
    ['one with a time still to come', stored(CHOICE, NOW + 1)],
    ['one without a time', JSON.stringify(CHOICE)],
    ['what is no choice at all', 'not json'],
  ])('removes %s when a page starts', (_, raw) => {
    values.set('medibooker.booking-choice', raw);
    expireChoice();
    expect(readRawChoice()).toBeNull();
  });

  it('has nothing to do when nothing is stored', () => {
    expireChoice();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('copes with a browser that refuses its storage', () => {
    vi.stubGlobal('window', {
      get sessionStorage(): never {
        throw new Error('denied');
      },
    });
    expect(() => {
      saveChoice(CHOICE);
      expireChoice();
      clearChoice();
    }).not.toThrow();
    expect(readRawChoice()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
