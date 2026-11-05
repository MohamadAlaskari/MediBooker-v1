import type { ServerResponse } from 'node:http';
import { ClsMiddleware, type ClsStore } from 'nestjs-cls';
import { REQUEST_ID_HEADER, requestIdOf, type IdentifiableRequest } from './request-id.js';

/**
 * The request context (nestjs-cls). The request id is the CLS id (`ClsService.getId()`). The
 * slots are typed now and filled later: `practice` by the tenancy layer (F04), `actor` by
 * authentication (A01); until then nothing may set them.
 */
export interface RequestContext extends ClsStore {
  practice?: never;
  actor?: never;
}

/**
 * The first middleware of the app (configureApp step 1): opens the request context, computes the
 * request id and echoes it in `X-Request-Id`, before helmet, CORS and the body parser run, so
 * every response carries it, also a 404, a CORS preflight and a body-parser rejection.
 */
export function requestContextMiddleware(): ClsMiddleware['use'] {
  return new ClsMiddleware({
    generateId: true,
    idGenerator: (req: IdentifiableRequest) => requestIdOf(req),
    setup: (cls, _req, res: ServerResponse) => {
      res.setHeader(REQUEST_ID_HEADER, cls.getId());
    },
  }).use;
}
