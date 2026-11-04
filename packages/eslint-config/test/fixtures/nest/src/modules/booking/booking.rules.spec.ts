// Tests may read the clock: the guardrail covers production code under src/modules only.
import { startsInFuture } from './booking.rules.js';

export const inOneMinute = startsInFuture(new Date(Date.now() + 60_000));
export const checkedAt = new Date();
