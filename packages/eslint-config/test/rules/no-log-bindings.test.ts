import rule from '../../src/plugin/rules/no-log-bindings.js';
import { runTypedRuleTests } from './typed-rule-tester.js';

function binding(name: string) {
  return { messageId: 'binding', data: { binding: name } };
}

runTypedRuleTests('no-log-bindings', rule, {
  valid: [
    'Object.assign(target, source);',
    "booking.child('reminder');",
    'booking.assign({ id });',
    "req.log.info({ practiceId }, 'practice resolved');",
    'const prefix = logger.msgPrefix;',
    'declare const options: { msgPrefix?: string };\nconst { msgPrefix } = options;',
    "const options = { level: 'info' };",
  ],
  invalid: [
    // The call of the F03 security review.
    { code: 'req.log.child({ practiceId });', errors: [binding('.child()')] },
    { code: 'req.log?.child({ practiceId });', errors: [binding('.child()')] },
    { code: "logger['child']({ practiceId });", errors: [binding('.child()')] },
    { code: 'pinoLogger.logger.child({ practiceId });', errors: [binding('.child()')] },
    { code: 'logger.setBindings({ practiceId });', errors: [binding('.setBindings()')] },
    { code: 'pinoLogger.assign({ practiceId });', errors: [binding('.assign()')] },
    {
      code: 'pinoLogger.runInContext(() => undefined, { bindings: { practiceId } });',
      errors: [binding('.runInContext()')],
    },
    { code: 'runInContext(() => undefined);', errors: [binding('runInContext()')] },
    { code: "const options = { msgPrefix: '[booking] ' };", errors: [binding('msgPrefix')] },
    {
      code: "logger.child({}, { msgPrefix: '[booking] ' });",
      errors: [binding('.child()'), binding('msgPrefix')],
    },
  ],
});
