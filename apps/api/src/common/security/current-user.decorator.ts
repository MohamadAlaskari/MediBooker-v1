import { createParamDecorator } from '@nestjs/common';
import { ClsServiceManager } from 'nestjs-cls';
import type { RequestContext } from '../context/request-context.js';
import type { Actor } from './actor.js';

/**
 * The actor the guard verified: the only source of a user's identity (non-negotiable 2), never the
 * body or the query. On a route without authentication there is none, which is a bug: it throws.
 */
export const CurrentUser = createParamDecorator((): Actor => {
  const actor = ClsServiceManager.getClsService<RequestContext>().get('actor');
  if (actor === undefined) throw new Error('CurrentUser on a route without authentication');
  return actor;
});
