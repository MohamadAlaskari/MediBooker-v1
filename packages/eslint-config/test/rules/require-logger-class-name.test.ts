import rule from '../../src/plugin/rules/require-logger-class-name.js';
import { ruleTester } from './rule-tester.js';

/** Nest's Logger, imported as the API imports it. */
const NEST = "import { Logger } from '@nestjs/common';\n";

const className = { messageId: 'className' };

function staticCall(method: string) {
  return { messageId: 'staticCall', data: { method } };
}

// The rule needs no type information: these cases are parsed without a TypeScript program.
ruleTester.run('require-logger-class-name', rule, {
  valid: [
    `${NEST}class Probe {\n  private readonly logger = new Logger(Probe.name);\n}`,
    `${NEST}class Probe {\n  private readonly logger = new Logger(Probe.name, { timestamp: true });\n}`,
    `${NEST}import { BookingService } from './booking.service.js';\nconst logger = new Logger(BookingService.name);`,
    "import { Logger as NestLogger } from '@nestjs/common';\nclass Probe {\n  private readonly logger = new NestLogger(Probe.name);\n}",
    "import * as common from '@nestjs/common';\nclass Probe {\n  private readonly logger = new common.Logger(Probe.name);\n}",
    // Other classes named Logger are not checked.
    "import { Logger } from 'nestjs-pino';\nconst logger = new Logger(pinoLogger, params);",
    "import { Logger } from './logger.js';\nconst logger = new Logger('Probe');",
    'class Logger {\n  constructor(readonly name?: string) {}\n}\nconst logger = new Logger();',
    // A parameter that shadows the import is no Nest Logger.
    `${NEST}function create(Logger: new () => object): object {\n  return new Logger();\n}`,
    // Calls on an instance, and static methods that write no log line.
    `${NEST}class Probe {}\nnew Logger(Probe.name).log('booked for %s', email);`,
    `${NEST}Logger.flush();`,
  ],
  invalid: [
    // The calls of the F03 security review.
    { code: `${NEST}const logger = new Logger();`, errors: [className] },
    { code: `${NEST}const logger = new Logger('Probe');`, errors: [className] },
    { code: `${NEST}new Logger('Probe').warn(err.message);`, errors: [className] },
    { code: `${NEST}new Logger().error(err.message, err.stack);`, errors: [className] },
    // Any context other than the name of a class.
    { code: `${NEST}const logger = new Logger(\`Probe\`);`, errors: [className] },
    {
      code: `${NEST}const context = 'Probe';\nconst logger = new Logger(context);`,
      errors: [className],
    },
    {
      code: `${NEST}const user = { name: 'Sara' };\nconst logger = new Logger(user.name);`,
      errors: [className],
    },
    {
      code: `${NEST}class Probe {\n  private readonly logger = new Logger(this.constructor.name);\n}`,
      errors: [className],
    },
    {
      code: `${NEST}class Probe {}\nconst logger = new Logger(Probe['name']);`,
      errors: [className],
    },
    { code: `${NEST}const logger = new Logger(...contexts);`, errors: [className] },
    // Nest's Logger under another name.
    {
      code: "import { Logger as NestLogger } from '@nestjs/common';\nconst logger = new NestLogger();",
      errors: [className],
    },
    {
      code: "import * as common from '@nestjs/common';\nconst logger = new common.Logger('Probe');",
      errors: [className],
    },
    {
      code: "import * as common from '@nestjs/common';\nconst logger = new common['Logger']();",
      errors: [className],
    },
    // The static log methods have no context of their own.
    { code: `${NEST}Logger.log('booked for %s', firstName);`, errors: [staticCall('log')] },
    {
      code: "import * as common from '@nestjs/common';\ncommon.Logger.warn('reminder failed');",
      errors: [staticCall('warn')],
    },
  ],
  assertionOptions: { requireMessage: 'messageId', requireData: 'error' },
});
