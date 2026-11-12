/**
 * A practice whose connections are busy, on real PostgreSQL: others get an honest 503 with a time to
 * come back, not a 500, and nothing stays behind. One connection, so that one booking waiting for a
 * row takes all of them; the lock wait is longer than the pool's two seconds, so that both show.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { useBookingWorld } from './booking-world.js';

describe('booking while the practice is busy, on real PostgreSQL', () => {
  const world = useBookingWorld({
    PRACTICE_POOL_MAX: '1',
    DATABASE_LOCK_TIMEOUT_MS: '3000',
    DATABASE_TX_TIMEOUT_MS: '8000',
  });

  it('answers 503 with Retry-After to a waiting booking and to others, and a retry books', async () => {
    const practice = world.alNoor();
    const who = await world.person();
    // Someone else, signed in, who only looks at the free times (B07).
    const viewer = await world.person();
    const patientId = await world.join(who, practice);
    const startsAt = await world.freshSlot(practice);
    const body = { serviceId: practice.serviceId, startsAt: startsAt.toString() };
    const key = randomUUID();

    const holder = await practice.practice.connectAsOwner();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM patients WHERE id = $1 FOR UPDATE', [patientId]);

      const waiting = world.book(who, practice, body, key).then((response) => response);
      await new Promise((resolve) => setTimeout(resolve, 300));

      const other = await world.freeTimes(viewer, practice, {
        serviceId: practice.serviceId,
        date: '2026-11-16',
      });
      expect(other.status).toBe(503);
      expect(other.body).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
      expect(other.headers['retry-after']).toBe('30');

      const booking = await waiting;
      expect(booking.status).toBe(503);
      expect(booking.body).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
      expect(booking.headers['retry-after']).toBe('30');
    } finally {
      await holder.query('ROLLBACK');
      await holder.end();
    }

    await expect(world.activeAt(practice, startsAt)).resolves.toEqual([]);
    const retry = await world.book(who, practice, body, key);
    expect(retry.status).toBe(201);
  });
});
