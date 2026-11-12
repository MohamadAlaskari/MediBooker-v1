import type { DeskWeekDto, DeskWeekSlotDto } from '@medibooker/api-client';
import { describe, expect, it } from 'vitest';
import { practiceFormat } from '@/lib/format';
import { calendarGrid, minutesOf } from './calendar-view';

const SETTINGS = { timeZone: 'Asia/Riyadh', numberingSystem: 'latn', hourCycle: 'h23' } as const;
const format = practiceFormat('en', SETTINGS);

/** A free slot of 30 minutes; Riyadh is three hours ahead of UTC. */
function free(startsAt: string): DeskWeekSlotDto {
  return {
    id: `80000000-0000-4000-8000-${startsAt.replaceAll(/\D/gu, '').slice(0, 12)}`,
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + 30 * 60_000).toISOString().replace('.000', ''),
    status: 'OPEN',
    appointment: null,
    continuation: false,
  };
}

function week(fields: Partial<DeskWeekDto>): DeskWeekDto {
  return {
    from: '2026-11-15',
    to: '2026-11-21',
    today: '2026-11-15',
    now: '2026-11-15T07:00:00Z',
    providerId: '70000000-0000-4000-8000-000000000001',
    slots: [],
    absences: [],
    truncated: false,
    ...SETTINGS,
    ...fields,
  };
}

describe('calendarGrid', () => {
  it('has a row per start time and a column per day the doctor works', () => {
    const grid = calendarGrid(
      week({
        slots: [
          free('2026-11-16T06:00:00Z'),
          free('2026-11-15T05:30:00Z'),
          free('2026-11-15T05:00:00Z'),
        ],
      }),
      format,
    );
    expect(grid.days).toEqual(['2026-11-15', '2026-11-16']);
    expect(grid.rows.map(({ time }) => time)).toEqual(['08:00', '08:30', '09:00']);
    expect(grid.rows[0]?.cells.map(({ kind }) => kind)).toEqual(['slot', 'empty']);
    expect(grid.rows[2]?.cells.map(({ kind }) => kind)).toEqual(['empty', 'slot']);
  });

  it('shows an absence in the times it covers, also on a day without any slot', () => {
    const grid = calendarGrid(
      week({
        slots: [free('2026-11-15T05:00:00Z'), free('2026-11-15T06:00:00Z')],
        absences: [
          // 08:30 to 09:30 on Sunday, and all of Tuesday.
          { startsAt: '2026-11-15T05:30:00Z', endsAt: '2026-11-15T06:30:00Z', reason: 'TRAINING' },
          { startsAt: '2026-11-16T21:00:00Z', endsAt: '2026-11-17T21:00:00Z', reason: 'VACATION' },
        ],
      }),
      format,
    );
    expect(grid.days).toEqual(['2026-11-15', '2026-11-17']);
    // A slot wins over an absence that covers it; a time without one shows the absence.
    expect(grid.rows.map(({ cells }) => cells.map((cell) => cell.kind))).toEqual([
      ['slot', 'absence'],
      ['slot', 'absence'],
    ]);
    expect(grid.rows[1]?.cells[1]).toEqual({ kind: 'absence', reason: 'VACATION' });
  });

  it('has no column and no row in a week without times', () => {
    expect(calendarGrid(week({}), format)).toEqual({ days: [], rows: [] });
  });
});

describe('minutesOf', () => {
  it('counts the minutes of a slot', () => {
    expect(minutesOf(free('2026-11-15T05:00:00Z'))).toBe(30);
  });
});
