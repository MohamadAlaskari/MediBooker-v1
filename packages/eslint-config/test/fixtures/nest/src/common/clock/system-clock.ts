export interface Clock {
  now(): Date;
}

/** The one place that reads the wall clock; domain code receives a Clock instead. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
