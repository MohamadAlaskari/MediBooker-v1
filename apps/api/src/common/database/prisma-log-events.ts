/**
 * Prisma's warn and error logs as events, for both Prisma clients (02 §8). Prisma would otherwise
 * print them to stdout, outside pino; the subscribers log them through pino with constant
 * messages, never an event's message (which can carry query values) or target.
 */
export const PRISMA_LOG_EVENTS: [
  { emit: 'event'; level: 'warn' },
  { emit: 'event'; level: 'error' },
] = [
  { emit: 'event', level: 'warn' },
  { emit: 'event', level: 'error' },
];
