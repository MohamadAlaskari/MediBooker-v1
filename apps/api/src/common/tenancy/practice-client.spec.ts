import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import { fakePinoLogger } from '../../../test/support/fake-pino-logger.js';
import { PracticeClientFactory } from './practice-client.js';

const PRACTICE_ID = '00000000-0000-4000-8000-00000000000a';

/** A port that refuses connections: it was free a moment ago. */
async function refusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no TCP address');
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  return address.port;
}

describe('PracticeClientFactory', () => {
  it('builds a client that connects on its first query, and logs Prisma error events with the practice id and a constant message only', async () => {
    const { logger, calls } = fakePinoLogger();
    const client = new PracticeClientFactory(logger).create(PRACTICE_ID, {
      host: '127.0.0.1',
      port: await refusedPort(),
      database: 'practice_0000000000004000800000000000000a',
      user: 'practice_0000000000004000800000000000000a_app',
      password: 'example-secret-value',
      ssl: false,
      poolMax: 1,
    });
    try {
      expect(calls).toEqual([]);
      await expect(client.$queryRaw`SELECT 1`).rejects.toMatchObject({ code: 'P2010' });
      expect(calls).toEqual([
        { level: 'error', fields: { practiceId: PRACTICE_ID }, message: 'practice database error' },
      ]);
      expect(JSON.stringify(calls)).not.toMatch(/secret-value|practice_0{4}/);
    } finally {
      await client.$disconnect();
    }
  });
});
