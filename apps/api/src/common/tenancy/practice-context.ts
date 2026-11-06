import type { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../context/request-context.js';
import type { PracticeLease } from './practice-client.js';
import { PracticeContextMissingError } from './practice-errors.js';
import type { PracticeListing, ResolvedPractice } from './practice-route.js';

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
}

/** The practice context of the current request or `runInPractice` call; throws without one. */
export function requirePracticeContext(cls: ClsService<RequestContext>): PracticeContext {
  const context: PracticeContext | undefined = cls.isActive() ? cls.get('practice') : undefined;
  if (context === undefined) throw new PracticeContextMissingError();
  return context;
}
