import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { isPublicHandler } from './public.decorator.js';

/**
 * The global guard, deny by default: every route whose handler lacks `@Public()` answers 401. It
 * reads the handler only, never the controller class. A01 adds the verification of the access
 * token and the session; until then no route is reachable without `@Public()`.
 */
@Injectable()
export class AuthenticationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (isPublicHandler(context.getHandler())) return true;
    throw new UnauthorizedException();
  }
}
