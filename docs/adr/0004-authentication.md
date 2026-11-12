# 0004. Authentication: built-in in the NestJS API
Status: Accepted — 2026-11-01 (decided by the client)

## Context

Patients, family managers and practice staff sign in to the patient app, the patient portal and the practice dashboard. The platform hosts many practices (ADR 0005) and processes health data, so accounts, sessions and second factors must be strong, auditable and stay in the market's hosting region. The options were a built-in implementation, a self-hosted identity provider (Keycloak) or a hosted service (Auth0, Clerk). Practices that send appointment messages only by SMS raised the question of signing in with a phone number.

## Decision

1. **Built-in authentication in the NestJS API** (`auth` module); no external identity provider.
2. **One account per person on the platform** (`User`, unique e-mail, case-insensitive). What a person may do in a practice comes from their membership in that practice (staff roles) or their patient profile there (ADR 0005).
3. **E-mail address is required in v1** (verification before the first booking). Sign-in with phone number and SMS code is added later, once an SMS provider is chosen; the identity model keeps room for a verified phone as a second login identifier.
4. **Passwords:** argon2id (at least m = 19 MiB, t = 2, p = 1), minimum length 10 for patients and 12 for staff, checked against a breached-password list, no composition rules, paste allowed.
5. **Tokens:** short-lived access JWT (≤ 15 minutes, asymmetric signature, claims `iss`, `aud`, `sub`, `sid`, `amr`); opaque 256-bit refresh token stored only as a SHA-256 hash in `Session`, rotated on every use; reuse of an old refresh token revokes the whole token family. Signing keys come from the secret store and survive restarts.
6. **Web:** access and refresh tokens only in `HttpOnly; Secure; SameSite` cookies plus a CSRF token header; nothing in `localStorage`. **Mobile:** `Authorization: Bearer`, refresh token in the device's secure storage, one in-flight refresh at a time.
7. **Second factor:** TOTP is mandatory for every staff membership (receptionist, doctor, admin) with hashed recovery codes; optional for patients later.
8. **Abuse protection:** generic login errors, rate limits per IP and account with backoff, identical responses for register and password reset whether the account exists or not, verification and reset tokens single-use, hashed, valid 30 minutes; a reset also confirms the address, because its link reached the mailbox. A sign-in does not need a confirmed address: the user decided this on 2026-11-06 for a sign-up without a break, knowing that signing up and then signing in tells whether an address has an account (accepted risk RT-89, for the client's data protection officer before real patient data); "new sign-in" e-mail (E10) with "this was not me" → revoke all sessions and force a reset.
9. **Audit:** sign-in, sign-out, MFA changes, password changes and session revocations write `AuditEvent`s without personal data in the payload.

As built for the dashboard (A04, 2026-11-10): an account with a second factor sends its code, or one of ten recovery codes, together with the password in one request, and no session exists before both are right (`MFA_CODE_REQUIRED`, `MFA_CODE_INVALID`); there is no challenge token. Wrong codes count on their own, with the wait of wrong passwords, and a new password does not clear them, so whoever reads the mailbox gets no new tries; a code counts once. Setting up the factor replaces the session like a refresh, in its family, with `amr` `pwd` and `otp`, and ends the account's other sessions; the new tokens go into cookies for a browser and into the answer only for the app. Staff routes ask for `otp` before anything else (`MFA_REQUIRED`). Only the team sets up the factor for now: a patient could not get a lost one back without an operator. Details and what moved: 08 A04. Since M05 a refresh token of a session with both factors that is more than 30 minutes old ends its whole family (`IDLE`, audited as `auth.session.idle`): a front desk left alone, with its tab closed or its computer asleep, needs both factors again, and the dashboard asks the API on activity, at most every five minutes, so that a session in use refreshes in time. A patient's session keeps its days (RT-94).

## Consequences

Positive: full control over flows, Arabic/English UX and data residency; no per-user licence costs; one less service to operate.
As built for session control (A04 part 2b, 2026-11-12): a browser keeps a random device key (`__Secure-mb_device`), of which the platform keeps a per-account HMAC with the auth secret; a browser the account knows counts its own failed sign-ins (OWASP device cookies), every other client counts on the account, decaying by one per hour, and after 100 of them since the last success only a new password lets such clients in (NIST SP 800-63B §5.2.2); a sign-in family ends 90 days after its sign-in, however often it is refreshed; every sign-in but the account's first from a browser it does not know, or from the app until A06 gives it a device key, sends E10 to a confirmed address; E10, the "password changed" e-mail (E11) and "an authenticator app was set up" (E12) carry a one-week "this was not me" link (`POST /auth/sessions/revoke-all`) that ends every session, stops the password and sends a reset link, while the second factor stays; `/me/sessions` lists and ends the account's own sign-ins.

Negative: the team owns security-critical code — it needs thorough tests (token rotation and reuse, lockout, MFA) and the mandatory security review before every merge that touches auth.
Follow-ups: choose the breached-password source (local list or k-anonymity range API); key rotation procedure; phone sign-in when the SMS provider exists; passkeys (WebAuthn) as a later option.

## Alternatives considered

- Keycloak (self-hosted): mature SSO and MFA, but another server to operate, harden and theme for Arabic RTL; more moving parts for a small team.
- Hosted identity service (Auth0, Clerk): fastest start, but ongoing costs and difficult data-residency and health-data conditions per market.
