import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../support/create-test-app.js';
import { captureLogs, type LogLine } from '../support/log-capture.js';
import {
  PRACTICE_ID,
  ProbeModule,
  SYNTHETIC_EMAIL,
  SYNTHETIC_SECRET_VALUE,
} from '../support/probe.module.js';

/** The fields that pino and the request logger add to every line logged during a request. */
const LINE_FIELDS = ['hostname', 'level', 'pid', 'reqId', 'time'];

/** The synthetic values of the probe routes and the names of the fields they drop (02 §8). */
const NEVER_LOGGED = [
  SYNTHETIC_EMAIL,
  SYNTHETIC_SECRET_VALUE,
  'appointment',
  'address',
  'mfaSecret',
  'accessToken',
  '"error"',
  '"name"',
];

function fieldsOf(line: LogLine | undefined): string[] {
  return Object.keys(line ?? {}).sort();
}

describe('log calls written by hand during a request (02 §8)', () => {
  const logs = captureLogs();
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({ imports: [ProbeModule], logDestination: logs });
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * Calls a probe route, checks that no synthetic value or dropped field name reached the logs,
   * and returns the lines the route logged by hand, without the access line.
   */
  async function linesLoggedBy(route: string): Promise<LogLine[]> {
    const id = randomUUID();
    await request(app.getHttpServer())
      .get(`/api/v1/probe/logs/${route}`)
      .set('X-Request-Id', id)
      .expect(200);
    await logs.waitForAccessLine(id);
    for (const marker of NEVER_LOGGED) expect(logs.text()).not.toContain(marker);
    return logs.lines().filter((line) => line.reqId === id && line.responseTime === undefined);
  }

  it('drops the value of logger.log("booked for %s", email) and keeps the template and the context', async () => {
    const lines = await linesLoggedBy('format-argument');
    expect(lines).toEqual([
      expect.objectContaining({ level: 30, context: 'LogProbeController', msg: 'booked for %s' }),
    ]);
    expect(fieldsOf(lines[0])).toEqual([...LINE_FIELDS, 'context', 'msg'].sort());
  });

  it('drops an object with an e-mail address three levels down and counts it, without its name', async () => {
    const lines = await linesLoggedBy('nested-object');
    expect(lines).toEqual([
      expect.objectContaining({ level: 40, context: 'LogProbeController', droppedFields: 1 }),
    ]);
    expect(fieldsOf(lines[0])).toEqual([...LINE_FIELDS, 'context', 'droppedFields'].sort());
  });

  it('drops an error logged under another key than err, with its detail', async () => {
    const lines = await linesLoggedBy('error-under-other-key');
    expect(lines).toEqual([
      expect.objectContaining({ level: 50, msg: 'db failed', droppedFields: 1 }),
    ]);
    expect(fieldsOf(lines[0])).toEqual([...LINE_FIELDS, 'droppedFields', 'msg'].sort());
  });

  it('drops address, name, mfaSecret and accessToken, which the allowlist does not name', async () => {
    const lines = await linesLoggedBy('unlisted-fields');
    expect(lines).toEqual([
      expect.objectContaining({ level: 30, msg: 'fields', droppedFields: 4 }),
    ]);
    expect(fieldsOf(lines[0])).toEqual([...LINE_FIELDS, 'droppedFields', 'msg'].sort());
  });

  it('drops an e-mail address that nestjs-pino passes as the context of a Nest Logger without one', async () => {
    const lines = await linesLoggedBy('argument-as-context');
    expect(lines).toEqual([
      expect.objectContaining({ level: 30, msg: 'booked for %s', droppedFields: 1 }),
    ]);
    expect(fieldsOf(lines[0])).toEqual([...LINE_FIELDS, 'droppedFields', 'msg'].sort());
  });

  it('F04 bindLogFields binds a reviewed field to the rest of the request and its access line, and drops one outside the allowlist', async () => {
    const id = randomUUID();
    await request(app.getHttpServer())
      .get('/api/v1/probe/logs/bound-fields')
      .set('X-Request-Id', id)
      .expect(200);
    const accessLine = await logs.waitForAccessLine(id);
    for (const marker of NEVER_LOGGED) expect(logs.text()).not.toContain(marker);
    expect(logs.text()).not.toContain('email');
    const lines = logs
      .lines()
      .filter((line) => line.reqId === id && line.responseTime === undefined);
    expect(lines).toEqual([
      expect.objectContaining({
        level: 30,
        context: 'LogProbeController',
        practiceId: PRACTICE_ID,
        droppedFields: 1,
        msg: 'after binding',
      }),
    ]);
    expect(accessLine).toMatchObject({ practiceId: PRACTICE_ID, droppedFields: 1 });
  });

  it('keeps a reviewed id field and a context, and drops nothing', async () => {
    const lines = await linesLoggedBy('allowed-fields');
    expect(lines).toEqual([
      expect.objectContaining({ level: 30, practiceId: PRACTICE_ID, msg: 'practice resolved' }),
      expect.objectContaining({ level: 30, context: 'LogProbeController', msg: 'plain message' }),
    ]);
    expect(fieldsOf(lines[0])).toEqual([...LINE_FIELDS, 'msg', 'practiceId'].sort());
    expect(fieldsOf(lines[1])).toEqual([...LINE_FIELDS, 'context', 'msg'].sort());
  });
});
