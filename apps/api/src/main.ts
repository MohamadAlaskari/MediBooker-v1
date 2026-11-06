import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { APP_OPTIONS, configureApp } from './app.setup.js';
import { PlatformPrismaService } from './common/database/platform-prisma.service.js';
import { registerProcessHandlers } from './common/logging/process-handlers.js';
import { parseEnv } from './config/env.schema.js';
import { loadWorkspaceEnv } from './config/load-env.js';
import { SlotGenerationJob } from './modules/scheduling/slot-generation.job.js';

// The only place that reads process.env (02 §3), with the command line of cli/.
loadWorkspaceEnv(import.meta.dirname, process.env.NODE_ENV);
const env = parseEnv(process.env);

const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env), APP_OPTIONS);
configureApp(app, env);
// From here on a crash is logged through pino, never by Node to stderr (02 §8).
registerProcessHandlers(await app.resolve(PinoLogger), (code) => {
  process.exit(code);
});
await app.listen(env.PORT, env.HOST);
// No provider connects while the app is built (02 §8), so the platform database is checked
// here: a failure is logged through the process handlers as one fatal line, and the process
// exits with 1.
await app.get(PlatformPrismaService).assertReachable();
// Catches up on a night this instance was down, without holding up the start.
void app.get(SlotGenerationJob).runInBackground();
