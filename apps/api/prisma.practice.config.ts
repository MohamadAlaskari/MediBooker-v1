// The Prisma CLI configuration of every practice database (02 §9). Every command runs with
// apps/api (or PRISMA_ROOT in the migrate image) as the working directory and selects it with
// --config. The migration runner sets PRACTICE_MIGRATION_URL per practice; locally it names the
// authoring database.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

// Outside production, load the workspace root's .env. In the migrate image no
// pnpm-workspace.yaml exists above /app/schema, so nothing is loaded there.
if (process.env.NODE_ENV !== 'production') {
  for (let dir = process.cwd(); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      const file = path.join(dir, '.env');
      if (existsSync(file)) process.loadEnvFile(file);
      break;
    }
  }
}

// Plain process.env, never env() from prisma/config: env() throws for an unset variable, and the
// CLI loads this file for every command, so prisma generate works without a database while the
// migrate commands still fail fast without a URL.
export default defineConfig({
  schema: 'prisma/practice/schema.prisma',
  migrations: { path: 'prisma/practice/migrations' },
  datasource: {
    url: process.env.PRACTICE_MIGRATION_URL,
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
