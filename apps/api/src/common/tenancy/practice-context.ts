import type { ClsService } from 'nestjs-cls';
import type { StaffRole } from '../../generated/practice/enums.js';
import type { RequestContext } from '../context/request-context.js';
import type { PracticeLease } from './practice-client.js';
import { PracticeContextMissingError } from './practice-errors.js';
import type { PracticeListing, ResolvedPractice } from './practice-route.js';

/** The caller's membership on a staff route, as the practice database says now (A04). */
export interface StaffMembership {
  readonly membershipId: string;
  readonly role: StaffRole;
}

/**
 * The practice slot of the request context (02 §4): the resolved practice and the lease of its
 * client. Set by the PracticeContextInterceptor for a practice-scoped request and by
 * `runInPractice` outside requests; nothing else may set it.
 */
export interface PracticeContext {
  readonly practice: ResolvedPractice;
  readonly lease: PracticeLease;
  /** Only on a `@PracticeScoped('slug')` route: the registry's slug and name of the practice. */
  readonly listing?: PracticeListing;
  /** Only on a `{ patient: true }` route: the caller's own profile in this practice. */
  readonly selfPatientId?: string;
  /** Only on a `{ staff: [...] }` route: the caller's membership in this practice. */
  readonly staff?: StaffMembership;
}

/** The practice context of the current request or `runInPractice` call; throws without one. */
export function requirePracticeContext(cls: ClsService<RequestContext>): PracticeContext {
  const context: PracticeContext | undefined = cls.isActive() ? cls.get('practice') : undefined;
  if (context === undefined) throw new PracticeContextMissingError();
  return context;
}
