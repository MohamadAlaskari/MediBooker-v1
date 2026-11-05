import { describe, expect, it } from 'vitest';
import { fakePinoLogger } from '../../../test/support/fake-pino-logger.js';
import { bindLogFields } from './bind-log-fields.js';

const PRACTICE_ID = '00000000-0000-4000-8000-000000000001';

describe('bindLogFields (02 §8)', () => {
  it('binds a reviewed field in its form', () => {
    const { logger, assign } = fakePinoLogger();
    bindLogFields(logger, { practiceId: PRACTICE_ID });
    expect(assign).toHaveBeenCalledWith({ practiceId: PRACTICE_ID });
  });

  it('drops a binding outside the allowlist, or not in its form, and counts it without its name', () => {
    const { logger, assign } = fakePinoLogger();
    bindLogFields(logger, {
      practiceId: PRACTICE_ID,
      email: 'sara@example.test',
      clusterId: 'Sara Example',
    });
    expect(assign).toHaveBeenCalledWith({ practiceId: PRACTICE_ID, droppedFields: 2 });
  });
});
