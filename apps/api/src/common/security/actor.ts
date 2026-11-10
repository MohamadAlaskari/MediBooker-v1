/** The `amr` value of a second factor (RFC 8176): staff routes require it (ADR 0004 §7). */
export const AMR_ONE_TIME_CODE = 'otp';

/** Who a request acts for: from the verified token and the session row, never from the request. */
export interface Actor {
  readonly userId: string;
  readonly sessionId: string;
  /** How the person signed in, as the `amr` claim says. */
  readonly amr: readonly string[];
}

/** What authentication reads of a request. */
export interface AuthenticatableRequest {
  readonly method?: string | undefined;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

/**
 * The port of the guard: the auth module implements it. Undefined means no valid credentials, and
 * a request with valid cookies that lacks its CSRF header is rejected with a 403 by throwing.
 */
export abstract class Authenticator {
  abstract authenticate(request: AuthenticatableRequest): Promise<Actor | undefined>;
}
