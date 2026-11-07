/**
 * The upcoming appointments across a person's practices (ADR 0005 §9.1), on real databases, with one
 * practice at a time out of reach. Waiting for a reader that never answers is tested with fake timers
 * in practice-fan-out.spec.ts.
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { PRACTICE_SCHEMA_REQUIRED } from '../../../src/generated/schema-versions.js';
import { changeRegistry } from '../probes/registry.js';
import { withClient } from '../support/sql.js';
import { API, type Fixture, type Person, useBookingWorld } from './booking-world.js';

interface MyAppointments {
  items: { id: string; practiceId: string; startsAt: string }[];
  unavailablePractices: { practiceId: string; reason: string }[];
}

describe('my appointments across practices (ADR 0005 §9.1)', () => {
  // Long enough that a refused connection is never mistaken for a practice that takes too long.
  const world = useBookingWorld({ ME_FANOUT_TIMEOUT_MS: '15000' });

  const mine = async (who: Person): Promise<MyAppointments> => {
    const response = await world
      .send(request(world.server()).get(`${API}/me/appointments`), who)
      .expect(200);
    return response.body as MyAppointments;
  };

  const bookedIn = async (who: Person, practice: Fixture): Promise<string> => {
    const startsAt = await world.freshSlot(practice);
    const response = await world
      .book(who, practice, { serviceId: practice.serviceId, startsAt: startsAt.toString() })
      .expect(201);
    return (response.body as { id: string }).id;
  };

  /** A person who has joined both practices and booked in each. */
  const inBoth = async (): Promise<{ who: Person; inA: string; inB: string }> => {
    const who = await world.person();
    await world.join(who, world.alNoor());
    await world.join(who, world.lindenhof());
    return {
      who,
      inA: await bookedIn(who, world.alNoor()),
      inB: await bookedIn(who, world.lindenhof()),
    };
  };

  it('joins what is to come in each practice, soonest first, each with its own practice', async () => {
    const { who, inA, inB } = await inBoth();
    const answer = await mine(who);
    expect(answer.unavailablePractices).toEqual([]);
    expect(answer.items.map(({ id, practiceId }) => [id, practiceId]).toSorted()).toEqual(
      [
        [inA, world.alNoor().practice.practiceId],
        [inB, world.lindenhof().practice.practiceId],
      ].toSorted(),
    );
    const starts = answer.items.map(({ startsAt }) => Temporal.Instant.from(startsAt));
    expect(starts.toSorted((a, b) => Temporal.Instant.compare(a, b))).toEqual(starts);
  });

  it('leaves out what was cancelled, and what belongs to someone else', async () => {
    const { who, inA, inB } = await inBoth();
    const other = await world.patient(world.alNoor());
    await bookedIn(other, world.alNoor());
    const changeable = await world.changeableSlot(world.alNoor());
    const cancelled = await world
      .book(who, world.alNoor(), {
        serviceId: world.alNoor().serviceId,
        startsAt: changeable.toString(),
      })
      .expect(201);
    await world.cancel(who, world.alNoor(), (cancelled.body as { id: string }).id).expect(200);
    const answer = await mine(who);
    expect(answer.items.map(({ id }) => id).toSorted()).toEqual([inA, inB].toSorted());
  });

  it('answers an account without a practice with nothing', async () => {
    await expect(mine(await world.person())).resolves.toEqual({
      items: [],
      unavailablePractices: [],
    });
  });

  it('finds nothing through an index row that the practice database does not confirm', async () => {
    const who = await world.person();
    await world.platform().practiceAccess.create({
      data: {
        userId: who.userId,
        practiceId: world.alNoor().practice.practiceId,
        capacity: 'PATIENT',
        active: true,
      },
    });
    await expect(mine(who)).resolves.toEqual({ items: [], unavailablePractices: [] });
  });

  it('with a practice behind a closed port: the others at once, and that one named', async () => {
    const { who, inA } = await inBoth();
    const unreachable = world.lindenhof().practice.practiceId;
    await withClient(world.platformOwnerUrl(), async (platform) => {
      await platform.query(
        `INSERT INTO database_clusters (id, region, host, port, tls_mode, database_limit)
         VALUES ('closed-port', 'test', '127.0.0.1', 9, 'DISABLE', 1)`,
      );
      await platform.query(
        "UPDATE practices SET cluster_id = 'closed-port', route_version = route_version + 1 WHERE id = $1",
        [unreachable],
      );
    });
    try {
      const answer = await mine(who);
      expect(answer.items.map(({ id }) => id)).toEqual([inA]);
      expect(answer.unavailablePractices).toEqual([
        { practiceId: unreachable, reason: 'UNAVAILABLE' },
      ]);
    } finally {
      await withClient(world.platformOwnerUrl(), async (platform) => {
        await platform.query(
          `UPDATE practices SET cluster_id = (SELECT cluster_id FROM practices WHERE id = $2),
             route_version = route_version + 1 WHERE id = $1`,
          [unreachable, world.alNoor().practice.practiceId],
        );
        await platform.query("DELETE FROM database_clusters WHERE id = 'closed-port'");
      });
    }
  });

  it('leaves out a practice that does not exist any more', async () => {
    const { who, inA } = await inBoth();
    const other = world.lindenhof().practice.practiceId;
    await changeRegistry(world.platformOwnerUrl(), other, { status: 'FINALIZED' });
    try {
      const answer = await mine(who);
      expect(answer.items.map(({ id }) => id)).toEqual([inA]);
      expect(answer.unavailablePractices).toEqual([]);
    } finally {
      await changeRegistry(world.platformOwnerUrl(), other, { status: 'ACTIVE' });
    }
  });

  it.each([
    ['being removed, with a row still active', { status: 'DEPROVISIONING' }, { status: 'ACTIVE' }],
    [
      'behind the schema this API needs',
      { schemaVersion: '00000000000000_older' },
      { schemaVersion: PRACTICE_SCHEMA_REQUIRED },
    ],
  ] as const)('names a practice %s, and returns the others', async (_, change, back) => {
    const { who, inA } = await inBoth();
    const other = world.lindenhof().practice.practiceId;
    await changeRegistry(world.platformOwnerUrl(), other, change);
    try {
      const answer = await mine(who);
      expect(answer.items.map(({ id }) => id)).toEqual([inA]);
      expect(answer.unavailablePractices).toEqual([{ practiceId: other, reason: 'UNAVAILABLE' }]);
    } finally {
      await changeRegistry(world.platformOwnerUrl(), other, back);
    }
  });
});

describe('my appointments beyond the first practices (ADR 0005 §9.1)', () => {
  const world = useBookingWorld({ ME_FANOUT_MAX_PRACTICES: '1' });

  it('asks the one changed most recently, and names the other as LIMIT', async () => {
    const who = await world.person();
    await world.join(who, world.alNoor());
    await world.join(who, world.lindenhof());
    await withClient(world.platformOwnerUrl(), (platform) =>
      platform.query(
        "UPDATE practice_access SET updated_at = now() - interval '1 hour' WHERE user_id = $1 AND practice_id = $2",
        [who.userId, world.alNoor().practice.practiceId],
      ),
    );
    const response = await world
      .send(request(world.server()).get(`${API}/me/appointments`), who)
      .expect(200);
    expect((response.body as MyAppointments).unavailablePractices).toEqual([
      { practiceId: world.alNoor().practice.practiceId, reason: 'LIMIT' },
    ]);
  });
});
