/**
 * Control menu "Konto für die Praxisverwaltung freischalten", or by hand:
 * `node dist/cli/staff-role.js <e-mail> [STAFF|DOCTOR|NONE] [MANAGE] [<doctor id>]`. Gives an
 * existing account with a confirmed address its place in the practice of this installation
 * (PRACTICE_SLUG, ADR 0016): a base role (D17), the practice team (STAFF) or a doctor (DOCTOR); with
 * MANAGE also practice management; with a doctor id the doctor it is (M04). Only the e-mail: the
 * practice team with practice management, the first manager before anyone in the practice can give
 * a role. NONE ends the membership. One JSON line with the result and never the address; exit 1 when
 * nothing changed. Reads the environment of the API, like main.ts.
 */
import { userInfo } from 'node:os';
import { NestFactory } from '@nestjs/core';
import { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';
import { AppModule } from '../app.module.js';
import { registerProcessHandlers } from '../common/logging/process-handlers.js';
import { parseEnv } from '../config/env.schema.js';
import { loadWorkspaceEnv } from '../config/load-env.js';
import { STAFF_ROLES, StaffRoles } from '../modules/staff/staff-roles.js';
import { parseStaffRoleArguments } from './staff-role-arguments.js';

loadWorkspaceEnv(import.meta.dirname, process.env.NODE_ENV);

function report(result: { readonly result: string; readonly [key: string]: unknown }): void {
  process.stdout.write(`${JSON.stringify({ command: 'staff:role', ...result })}\n`);
  process.exitCode = result.result === 'SET' || result.result === 'REMOVED' ? 0 : 1;
}

const email = z.email().safeParse(process.argv[2]?.trim());
const parsed = parseStaffRoleArguments(process.argv.slice(3));

if (!email.success) {
  report({ result: 'NO_EMAIL' });
} else if (parsed.kind === 'error') {
  report({ result: parsed.result, roles: [...STAFF_ROLES, 'NONE'] });
} else {
  // This one run is no instance of the outbox or the relay: their timers would start work it leaves.
  const env = parseEnv({ ...process.env, OUTBOX_POLL_SECONDS: '0', RELAY_POLL_SECONDS: '0' });
  const app = await NestFactory.createApplicationContext(AppModule.forRoot(env), {
    logger: false,
  });
  // As in main.ts: a crash is logged through pino, never by Node to stderr (02 §8).
  registerProcessHandlers(await app.resolve(PinoLogger), (code) => {
    process.exit(code);
  });
  const operator = `local:${userInfo().username}`;
  const outcome = await app.get(StaffRoles).setRole(email.data, parsed.role, operator, {
    managesPractice: parsed.managesPractice,
    ...(parsed.providerId === undefined ? {} : { providerId: parsed.providerId }),
  });
  await app.close();
  report(outcome);
}
