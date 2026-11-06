import { type DynamicModule, Module } from '@nestjs/common';
import type { Env } from './env.schema.js';

/** Injection token of the validated environment: `@Inject(ENV) private readonly env: Env`. */
export const ENV = Symbol('ENV');

/** Provides the `Env` that its entry point or a test parsed once; nothing reads `process.env` later. */
@Module({})
export class EnvModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: EnvModule,
      global: true,
      providers: [{ provide: ENV, useValue: env }],
      exports: [ENV],
    };
  }
}
