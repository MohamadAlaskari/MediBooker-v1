# 0014. Time handling: Temporal, practice zones, elapsed durations

Status: Accepted — 2026-11-06 (P04)

## Context

A practice works by the clock on its wall, in its own zone, and a practice may be in any market. A patient's rights count hours that really pass. On a day when the clocks change, these two readings of time differ, and some local times do not exist or occur twice. In `Africa/Cairo` a whole local midnight can be missing.

## Decision

1. **Temporal everywhere in the API.** A `Date` appears only at the Prisma boundary, in `common/time/convert.ts`. The current time comes only from `Clock`; a lint rule forbids the system clock in domain code.
2. **Instants on the wire and in the database.** `TIMESTAMPTZ` and `Z` strings. Local values are named as such: wall-clock minutes in a rule, an ISO date for a practice-local day.
3. **Wall-clock rules are read in the practice's zone.** Availability rules, opening hours and special days. A weekly Monday 08:00 stays 08:00 local across a change.
4. **A local time that does not exist is skipped; one that occurs twice gives one slot, at its earlier instant** (`generateSlots`). So a 03:00 rule on the spring change day has no 02:xx slots, and the autumn day has no duplicates.
5. **Durations are elapsed time.** BR-03's lead time and horizon, BR-04's cancellation deadline and BR-13's reminder count hours that pass, not wall-clock hours. A slot's end is its start plus its minutes in elapsed time, so it may reach over a change.
6. **A local day is a range of instants.** `dayRange` starts at the day's first existing time, which is not always 00:00, and ends where the next day starts, so a day has 23 or 25 hours on a change.

## Consequences

- A provider's rule yields fewer slots on the spring change day and no extra ones in autumn, and nobody has to think about it when writing a rule.
- The fixtures of [06 §3](../architecture/06-testing.md#br-15-fixtures) pin all of this with real dates in Berlin, Riyadh and Cairo. They use the time zone data of the running Node, so a change of a zone's rules can change a future slot: generation runs every night, and a slot that no rule backs any more is removed.
- Booked slots keep their instant when a zone's rules change. Staff see the change in the practice's zone, and it is theirs to handle.
