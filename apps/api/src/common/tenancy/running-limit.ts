import { DomainException } from '../errors/domain.exception.js';

/** What is under way ends soon, at the latest with a wait for a lock or a fan-out's timeout. */
const RETRY_AFTER_SECONDS = 1;

/**
 * How many runs of one key may be under way at a time, in this process. More is 429 with
 * `Retry-After`, before the work takes anything. It keeps what the limits per address do not see: an
 * account with many addresses. Nothing stays behind for a key with nothing under way.
 */
export class RunningLimit {
  private readonly underWay = new Map<string, number>();

  async run<T>(key: string, limit: number, work: () => Promise<T>): Promise<T> {
    const running = this.underWay.get(key) ?? 0;
    if (running >= limit) {
      throw new DomainException('RATE_LIMITED', { retryAfterSeconds: RETRY_AFTER_SECONDS });
    }
    this.underWay.set(key, running + 1);
    try {
      return await work();
    } finally {
      this.leave(key);
    }
  }

  /** How many keys have something under way. */
  get keys(): number {
    return this.underWay.size;
  }

  private leave(key: string): void {
    const left = (this.underWay.get(key) ?? 1) - 1;
    if (left === 0) this.underWay.delete(key);
    else this.underWay.set(key, left);
  }
}
