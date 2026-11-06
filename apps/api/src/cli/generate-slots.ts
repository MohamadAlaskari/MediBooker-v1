/**
 * `pnpm slots:generate`: one run of the nightly slot generation, for example right after new rules
 * reach a database, such as the demo practices of the seed. One JSON line; exit 1 when a practice
 * failed. Reads the environment of the API, like main.ts.
 */
import { NestFactory } from '@nestjs/core';
import { PinoLogger } from 'nestjs-pino';
import { AppModule } from '../app.module.js';
import { registerProcessHandlers } from '../common/logging/process-handlers.js';
import { parseEnv } from '../config/env.schema.js';
import { loadWorkspaceEnv } from '../config/load-env.js';
import { SlotGenerationJob } from '../modules/scheduling/slot-generation.job.js';

loadWorkspaceEnv(import.meta.dirname, process.env.NODE_ENV);

const app = await NestFactory.createApplicationContext(AppModule.forRoot(parseEnv(process.env)), {
  logger: false,
});
// As in main.ts: a crash is logged through pino, never by Node to stderr (02 §8).
registerProcessHandlers(await app.resolve(PinoLogger), (code) => {
  process.exit(code);
});
const summary = await app.get(SlotGenerationJob).run();
await app.close();
process.stdout.write(`${JSON.stringify({ command: 'slots:generate', ...summary })}\n`);
process.exitCode = summary.failed === 0 ? 0 : 1;
