import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../context/request-context.js';
import { type AuthenticatableRequest, Authenticator } from './actor.js';
import { isPublicHandler } from './public.decorator.js';

/**
 * The global guard, deny by default: every route whose handler lacks `@Public()` needs a valid
 * access token and a live session, read on every request, so a revocation takes effect at once.
 * It reads the handler only, never the controller class.
 */
@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    private readonly authenticator: Authenticator,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (isPublicHandler(context.getHandler())) return true;
    const request = context.switchToHttp().getRequest<AuthenticatableRequest>();
    const actor = await this.authenticator.authenticate(request);
    if (actor === undefined) throw new UnauthorizedException();
    this.cls.set('actor', actor);
    return true;
  }
}
