import { Injectable } from '@nestjs/common';
import { Clock } from './clock.js';

/** The one place that reads the system clock; everything else receives a Clock. */
@Injectable()
export class SystemClock extends Clock {
  now(): Temporal.Instant {
    return Temporal.Now.instant();
  }
}
