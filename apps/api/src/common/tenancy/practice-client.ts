import type { ConnectionOptions } from 'node:tls';
import { Injectable } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PinoLogger } from 'nestjs-pino';
import { PrismaClient } from '../../generated/practice/client.js';
import { PRISMA_LOG_EVENTS } from '../database/prisma-log-events.js';

/** A client of one practice database: the generated practice Prisma client (02 §5). */
export type PracticeClient = PrismaClient;

/** A practice client leased from the connection manager, until `release()` (02 §5 item 4). */
export interface PracticeLease {
  readonly practiceId: string;
  readonly client: PracticeClient;
  /** Ends this use of the client; a second call does nothing. Safe to pass on unbound. */
  readonly release: () => void;
}

/** Where and as whom a practice client connects; built by PracticeClientOpener. */
export interface PracticeConnection {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
  /** TLS with the cluster's CA, or false for a cluster without TLS (local and ci only). */
  readonly ssl: ConnectionOptions | false;
  readonly poolMax: number;
}

/**
 * Builds practice clients (02 §5 item 3). A replaceable provider, so the connection manager's
 * tests can hand out fakes. Building does no I/O: the pool connects on the first query.
 */
@Injectable()
export class PracticeClientFactory {
  constructor(private readonly logger: PinoLogger) {
    logger.setContext(PracticeClientFactory.name);
  }

  create(practiceId: string, connection: PracticeConnection): PracticeClient {
    const client = new PrismaClient({
      adapter: new PrismaPg({
        host: connection.host,
        port: connection.port,
        database: connection.database,
        user: connection.user,
        password: connection.password,
        ssl: connection.ssl,
        max: connection.poolMax,
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 2_000,
        application_name: 'medibooker-api',
      }),
      errorFormat: 'minimal',
      log: PRISMA_LOG_EVENTS,
    });
    // Constant messages: an event's message can carry query values (02 §8).
    client.$on('warn', () => {
      this.logger.warn({ practiceId }, 'practice database warning');
    });
    client.$on('error', () => {
      this.logger.error({ practiceId }, 'practice database error');
    });
    return client;
  }
}
