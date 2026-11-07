import { describe, expect, it } from 'vitest';
import { RunningLimit } from './running-limit.js';

describe('RunningLimit', () => {
  it('runs up to the limit per key, and answers more with 429 and a time to come back', async () => {
    const limit = new RunningLimit();
    const { promise, resolve } = Promise.withResolvers<string>();
    const running = [limit.run('a', 2, () => promise), limit.run('a', 2, () => promise)];
    await expect(limit.run('a', 2, () => Promise.resolve('third'))).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterSeconds: 1,
    });
    await expect(limit.run('b', 2, () => Promise.resolve('other'))).resolves.toBe('other');
    resolve('done');
    await expect(Promise.all(running)).resolves.toEqual(['done', 'done']);
    await expect(limit.run('a', 2, () => Promise.resolve('later'))).resolves.toBe('later');
  });

  it('frees the place after a failure, and keeps nothing for a key with nothing under way', async () => {
    const limit = new RunningLimit();
    await expect(limit.run('a', 1, () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(limit.run('a', 1, () => Promise.resolve('next'))).resolves.toBe('next');
    expect(limit.keys).toBe(0);
  });
});
