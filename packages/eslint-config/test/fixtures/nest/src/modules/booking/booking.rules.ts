// Synthetic violations: domain rules that read the wall clock instead of an injected Clock.
export function startsInFuture(startsAt: Date): boolean {
  return startsAt.getTime() > Date.now();
}

export function bookedAt(): Date {
  return new Date();
}
