import rule from '../../src/plugin/rules/no-system-clock.js';
import { ruleTester } from './rule-tester.js';

function systemClock(read: string) {
  return { messageId: 'systemClock', data: { read } };
}

ruleTester.run('no-system-clock', rule, {
  valid: [
    'const startsAt = new Date(isoString);',
    'const startsAt = new Date(1_767_258_000_000);',
    'const utc = Date.UTC(2026, 10, 1, 8, 30);',
    "const parsed = Date.parse('2026-11-01T08:30:00Z');",
    'const now = clock.now();',
    "const instant = Temporal.Instant.from('2026-11-01T08:30:00Z');",
    'const now = appointment.now;',
  ],
  invalid: [
    { code: 'const now = new Date();', errors: [systemClock('new Date()')] },
    { code: 'const now = new Date;', errors: [systemClock('new Date()')] },
    { code: 'const ms = Date.now();', errors: [systemClock('Date.now')] },
    { code: 'const read = Date.now;', errors: [systemClock('Date.now')] },
    { code: "const ms = Date['now']();", errors: [systemClock('Date.now')] },
    { code: 'const today = Temporal.Now.plainDateISO();', errors: [systemClock('Temporal.Now')] },
    { code: 'const text = Date();', errors: [systemClock('Date()')] },
  ],
});
