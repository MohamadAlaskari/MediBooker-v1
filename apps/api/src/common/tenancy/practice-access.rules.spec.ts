import { describe, expect, it } from 'vitest';
import type { PracticeStatus } from '../../generated/platform/enums.js';
import {
  type DeploymentScope,
  isMarketServed,
  isSchemaCurrent,
  practiceVerdict,
  statusAnswer,
} from './practice-access.rules.js';
import type { PracticePurpose } from './practice-route.js';

const REQUIRED = '20261105140000_practice_identity';

const CI: DeploymentScope = { appEnv: 'ci', markets: [], practiceSchemaRequired: REQUIRED };
const PRODUCTION: DeploymentScope = {
  appEnv: 'production',
  markets: ['SA', 'DE'],
  practiceSchemaRequired: REQUIRED,
};

const PURPOSES: PracticePurpose[] = ['public', 'request', 'job', 'fanOut'];

describe('statusAnswer: the status table of ADR 0005 §5.1', () => {
  it.each<[PracticeStatus, 'SERVE' | 'NOT_FOUND' | 'UNAVAILABLE']>([
    ['PROVISIONING', 'NOT_FOUND'],
    ['ACTIVE', 'SERVE'],
    ['SUSPENDED', 'UNAVAILABLE'],
    ['MOVING', 'UNAVAILABLE'],
    // Admins are served under restore review from A01; until then nobody is.
    ['RESTORE_REVIEW', 'UNAVAILABLE'],
    ['DEPROVISIONING', 'NOT_FOUND'],
    ['FINALIZED', 'NOT_FOUND'],
  ])(
    'ADR-0005 §5.1 answers %s with %s for public and signed-in requests and jobs',
    (status, answer) => {
      for (const purpose of PURPOSES) expect(statusAnswer(status, purpose)).toBe(answer);
    },
  );

  it('ADR-0005 §5.1 runs jobs only for ACTIVE practices', () => {
    const served = (
      [
        'PROVISIONING',
        'ACTIVE',
        'SUSPENDED',
        'MOVING',
        'RESTORE_REVIEW',
        'DEPROVISIONING',
        'FINALIZED',
      ] as const
    ).filter((status) => statusAnswer(status, 'job') === 'SERVE');
    expect(served).toEqual(['ACTIVE']);
  });
});

describe('isMarketServed (ADR 0005 §7.2)', () => {
  it('serves every market in local and ci, so the seed holds practices of two markets', () => {
    expect(isMarketServed('XX', CI)).toBe(true);
    expect(isMarketServed('SA', { ...CI, appEnv: 'local' })).toBe(true);
  });

  it('serves only the markets in MARKETS in staging and production', () => {
    expect(isMarketServed('SA', PRODUCTION)).toBe(true);
    expect(isMarketServed('XX', PRODUCTION)).toBe(false);
    expect(isMarketServed('DE', { ...PRODUCTION, appEnv: 'staging', markets: ['SA'] })).toBe(false);
  });
});

describe('isSchemaCurrent (ADR 0005 §6.8)', () => {
  it('accepts the required migration and a newer one', () => {
    expect(isSchemaCurrent(REQUIRED, REQUIRED)).toBe(true);
    expect(isSchemaCurrent('20261201090000_slots', REQUIRED)).toBe(true);
  });

  it('rejects an older migration and a practice without one', () => {
    expect(isSchemaCurrent('20261104235959_older', REQUIRED)).toBe(false);
    expect(isSchemaCurrent(null, REQUIRED)).toBe(false);
  });
});

describe('practiceVerdict', () => {
  const active = { status: 'ACTIVE', market: 'SA', schemaVersion: REQUIRED } as const;

  it('serves an ACTIVE practice of a served market with a current schema', () => {
    expect(practiceVerdict(active, 'request', PRODUCTION)).toEqual({ answer: 'SERVE' });
  });

  it('answers 404 by status before it checks market and schema', () => {
    expect(
      practiceVerdict(
        { status: 'PROVISIONING', market: 'XX', schemaVersion: null },
        'request',
        PRODUCTION,
      ),
    ).toEqual({ answer: 'NOT_FOUND' });
  });

  it('answers 503 by status before it checks market and schema', () => {
    expect(
      practiceVerdict({ ...active, status: 'SUSPENDED', market: 'XX' }, 'public', PRODUCTION),
    ).toEqual({ answer: 'UNAVAILABLE', reason: 'PRACTICE_STATUS_UNAVAILABLE' });
  });

  it('answers 503 for a market outside MARKETS, in staging and production only', () => {
    const outside = { ...active, market: 'XX' };
    expect(practiceVerdict(outside, 'request', PRODUCTION)).toEqual({
      answer: 'UNAVAILABLE',
      reason: 'PRACTICE_MARKET_NOT_SERVED',
    });
    expect(practiceVerdict(outside, 'request', CI)).toEqual({ answer: 'SERVE' });
  });

  it('answers 503 for a practice behind PRACTICE_SCHEMA_REQUIRED', () => {
    expect(
      practiceVerdict({ ...active, schemaVersion: '20261101000000_old' }, 'job', PRODUCTION),
    ).toEqual({ answer: 'UNAVAILABLE', reason: 'PRACTICE_SCHEMA_BEHIND' });
  });
});
