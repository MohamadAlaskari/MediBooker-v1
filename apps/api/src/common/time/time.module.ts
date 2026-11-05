import { Global, Module } from '@nestjs/common';
import { Clock } from './clock.js';
import { SystemClock } from './system-clock.js';

/** Provides the Clock everywhere; tests replace it with a FixedClock (createTestApp's `clock`). */
@Global()
@Module({
  providers: [{ provide: Clock, useClass: SystemClock }],
  exports: [Clock],
})
export class TimeModule {}
