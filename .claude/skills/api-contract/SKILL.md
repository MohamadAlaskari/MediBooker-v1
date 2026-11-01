---
name: api-contract
description: Contract-first API rules for MediBooker v2 — how the OpenAPI spec is produced from NestJS, how the typed client for web and mobile is generated, REST conventions (paths, JSON, dates, enums, pagination, errors, idempotency), backward compatibility for released mobile apps, error codes, realtime event contracts and the initial endpoint catalogue. Use when adding or changing an endpoint, DTO, error code or event, and when consuming the API from web or mobile.
---

# API contract

## Flow

1. `architect` designs the change: endpoint, DTOs, error codes, permissions.
2. `backend-engineer` implements DTOs and decorators in `apps/api`. The OpenAPI 3.1 document is generated from the code and committed as `apps/api/openapi.json`. CI fails if it is out of date.
3. `packages/api-client` is generated from it: types, fetch functions and TanStack Query hooks (generator: orval or hey-api, decide once). Never edit generated files.
4. Web and mobile import only from `@medibooker/api-client`. No handwritten `fetch` calls to the API.

## Conventions

| Topic | Rule |
|---|---|
| Base path | `/api/v1` |
| Paths | Plural nouns, kebab-case: `/appointments/{id}`, `/availability-rules` |
| State transitions | Action sub-resources: `POST /appointments/{id}/cancel`, `/reschedule`, `/check-in`, `/no-show`, `/complete` |
| JSON | camelCase |
| IDs | UUID strings |
| Timestamps | ISO 8601 in UTC with `Z` (`2026-11-04T08:30:00Z`). Date-only values as `YYYY-MM-DD`, interpreted in the practice time zone |
| Enums | UPPER_SNAKE (`BOOKED`, `PUBLIC`) |
| Lists | `GET /x?limit=20&cursor=…` → `{ items: [...], nextCursor: string \| null }`; `limit` ≤ 100 |
| Errors | `application/problem+json`: `{ type, title, status, detail, code, errors?: [{ field, code, message }] }` |
| Validation errors | 400 with `errors[]`; field paths in camelCase |
| Conflicts | 409 with a specific `code` |
| Idempotency | `Idempotency-Key` header (UUID) on `POST /appointments` and reschedule |
| Auth | Web: cookies + `X-CSRF-Token`. Mobile: `Authorization: Bearer <access token>` |
| Public endpoints | Only under `/public/...`, read-only, no cookies, explicit `@Public()`, own response DTOs, `Cache-Control: public, max-age=300`, ETag, `Vary: Accept-Language` |
| Language | The server returns codes, not translated sentences; clients translate `code`. Locales are BCP 47 (`ar`, `en`, more later); the user's `locale` is part of `/me`. `Accept-Language` / the stored locale select the language of e-mails and notifications. Names and free text are Unicode (Arabic and Latin) — never assume ASCII. |

## Compatibility (released mobile apps cannot update instantly)

- Inside `/v1`, only additive changes: new endpoints, new optional fields, new enum values (clients must handle unknown enum values with a fallback).
- Never rename or remove fields, change types, or tighten validation of existing fields without a deprecation period that covers the oldest supported app version.
- `GET /api/v1/app-config` returns `minimumSupportedVersion` so old apps can force an update.
- Deprecated fields get `deprecated: true` in OpenAPI and a removal date in the description.

## Error codes

Extend this list; never reuse a code with a different meaning.

`VALIDATION_FAILED`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `EMAIL_NOT_VERIFIED`, `INVALID_CREDENTIALS`, `ACCOUNT_LOCKED`, `MFA_REQUIRED`, `SLOT_NOT_AVAILABLE`, `BOOKING_LIMIT_REACHED`, `OUTSIDE_BOOKING_WINDOW`, `SERVICE_NOT_BOOKABLE`, `CANCELLATION_DEADLINE_PASSED`, `INVALID_STATUS_TRANSITION`, `SLOT_HAS_APPOINTMENT`, `IDEMPOTENCY_KEY_REUSED`, `RATE_LIMITED`, `NOT_A_MANAGED_PATIENT`, `GUARDIAN_DECLARATION_REQUIRED`, `INVITATION_EXPIRED`, `NOTE_NOT_EDITABLE`, `FILE_TOO_LARGE`, `FILE_TYPE_NOT_ALLOWED`, `FILE_REJECTED`, `FILE_NOT_READY`, `NOTIFICATION_PREFERENCE_LOCKED`, `PHONE_NOT_VERIFIED`, `SMS_NOT_ENABLED`, `VERIFICATION_CODE_INVALID`, `THEME_COLOR_INVALID`, `PRACTICE_SLUG_TAKEN`, `CONSENT_REQUIRED`.

## Endpoint catalogue (initial proposal)

| Method and path | Roles | Purpose | Rules |
|---|---|---|---|
| POST /auth/register | public | Patient sign-up | BR-10 |
| POST /auth/verify-email | public | Confirm the e-mail address | BR-09 |
| POST /auth/login | public | Login; returns an MFA challenge for staff roles | |
| POST /auth/mfa/verify | MFA pending | Second factor | |
| POST /auth/refresh | refresh token | Rotate tokens | |
| POST /auth/logout | any | Revoke the session | |
| POST /auth/password/forgot, POST /auth/password/reset | public | Password reset | |
| GET, PATCH /me | any | Own account and profile | |
| GET /me/export, DELETE /me | patient | DSGVO export and deletion | BR-14 |
| GET /me/appointments?scope=upcoming\|past | patient | Own appointments | |
| GET /services | public | Bookable services | BR-08 |
| POST /services, PATCH /services/{id} | admin | Manage services | |
| GET /availability?serviceId&providerId&from&to | public (decided 2026-11-01) | Days with free times (`hasFreeTimes` per day; no counts of booked times) | BR-03, BR-22 |
| GET /slots?serviceId&providerId&date | public (decided 2026-11-01) | Free start times of one day; `providerId` only for doctors with a public profile, otherwise grouped as any doctor; `Cache-Control: public, max-age=30`; rate-limited | BR-03, BR-22, BR-24 |
| POST /appointments | patient (for self), staff (with patientId) | Book | BR-01, 02, 03, 08, 09 |
| GET /appointments?from&to&providerId&status | staff, doctor, admin | Practice appointments | |
| GET /appointments/{id} | owner or staff | Details | |
| POST /appointments/{id}/cancel | owner (before the deadline), staff | Cancel | BR-04 |
| POST /appointments/{id}/reschedule | owner (before the deadline), staff | Atomic move | BR-05 |
| POST /appointments/{id}/check-in, /complete, /no-show | staff, doctor, admin | Status changes | BR-11 |
| GET, POST, PATCH, DELETE /availability-rules | staff, admin, doctor (own) | Weekly templates | BR-06 |
| POST /slots/generate | staff, admin | Generate slots for a date range | BR-06 |
| PATCH /slots/{id} | staff, admin | Block or unblock a slot | BR-07 |
| GET /patients?query, GET /patients/{id}, PATCH /patients/{id} | staff, doctor, admin | Patient records (reads are audited) | |
| GET /staff, POST /staff (invite), PATCH /staff/{id} | admin | Staff accounts, roles, disable | |
| GET, PATCH /settings | admin (GET also staff) | Booking rules, practice data | |
| GET /audit-events | admin | Audit log | |
| GET /app-config | public | Minimum app version, feature flags | |
| GET /me/patients | patient | Own (`SELF`) and managed patient profiles | BR-19 |
| POST /me/patients | patient | Add a child (with `guardianDeclaration: true`) | BR-19 |
| POST /me/patients/invitations | patient | Invite an adult family member (by e-mail or phone) | BR-19 |
| POST /family-invitations/{token}/accept | invited user | Accept being managed | BR-19 |
| DELETE /me/patients/{patientId} | patient | Unlink a managed profile | BR-19 |
| GET /me/patients/{patientId}/record | patient (own/managed) | Visits with `SHARED` notes and files | BR-18 |
| GET /patients/{id}/record | staff, doctor | Full record (clinical parts per role); audited | BR-18 |
| GET /appointments/{id}/notes, POST /appointments/{id}/notes | doctor (read also: setting) | List / create clinical notes | BR-16 |
| PATCH /notes/{id} | author doctor | Amend → new version (`previousVersionId`) | BR-16 |
| POST /notes/{id}/entered-in-error | author doctor, admin | Mark as wrong (no delete) | BR-16 |
| POST /appointments/{id}/attachments | doctor, staff | Start upload → `{ attachmentId, uploadUrl (pre-signed, ≤ 5 min) }` | BR-17 |
| POST /attachments/{id}/complete | uploader | Upload finished → scan starts (`PENDING`) | BR-17 |
| GET /attachments/{id}/download-url | allowed readers | Short-lived signed URL (`CLEAN` only); audited | BR-17 |
| PATCH /attachments/{id} | uploader, doctor | Change visibility | BR-17 |
| DELETE /attachments/{id} | uploader, admin | Soft delete with reason | BR-17 |
| GET, PATCH /me/notification-preferences | any | Read or change push / e-mail / SMS per message type; locked types → `NOTIFICATION_PREFERENCE_LOCKED`; SMS without a verified phone → `PHONE_NOT_VERIFIED`; practice whose `appointmentChannels` exclude SMS (or e-mail) → `SMS_NOT_ENABLED` | BR-21 |
| GET, PATCH /settings/notifications | admin (GET also staff, doctor) | `appointmentChannels` (`EMAIL`, `SMS`, `EMAIL_AND_SMS`), reminder on/off and `reminderHoursBefore`, `smsSenderId`; read-only `smsProviderStatus` (`NOT_CONNECTED`, `ACTIVE`) | BR-13, BR-21 |
| POST /settings/notifications/test | admin | Send a test reminder to the admin's own e-mail and verified phone | BR-21 |
| POST /me/phone/verification, POST /me/phone/verification/confirm | patient | Send a one-time code by SMS (S05) / confirm it (`VERIFICATION_CODE_INVALID`); sets `phoneVerifiedAt` | BR-21 |
| POST /me/devices | patient | Register or refresh a push token `{ platform, token, appVersion, locale }` (idempotent per token) | BR-21 |
| DELETE /me/devices/{id} | patient | Remove a push token (the app also calls it on sign-out) | BR-21 |
| POST /auth/sessions/revoke-all | signed-in user, or the single-use token from the "new sign-in" e-mail (E10) | Sign out everywhere and require a password reset | ADR 0001 |
| GET /public/practices/{slug} | public | Practice page: published profile fields, opening hours, special days (next 60 days), online-bookable services, team members with consent (name, specialty, languages, `photoUrl` or null), theme (preset, 11-step scale, logo URL, initials), locales. Unpublished → 404 | BR-22, BR-23, BR-24 |
| GET /providers?serviceId | patient | Doctors for the doctor picker: `displayName`, `photoUrl` (only with photo consent, else null → initials) | BR-24 |
| GET, PATCH /settings/practice-page | admin (GET also staff, doctor) | Publish, slug (`PRACTICE_SLUG_TAKEN`), about and directions per locale, sections shown, legal links | BR-22 |
| GET, PUT /opening-hours; GET, POST, DELETE /special-days | staff, admin | Practice opening hours (weekly intervals) and special days | BR-22 |
| GET, PATCH /settings/theme | admin (GET also staff, doctor) | Preset or custom hex (`THEME_COLOR_INVALID`); the response contains the generated scale and `adjusted` | BR-23 |
| POST /settings/logo, DELETE /settings/logo | admin | Logo upload via pre-signed URL (PNG/WebP), then scan and re-encoding as for attachments | BR-23 |
| GET, PATCH /me/public-profile | staff, doctor, admin | Own specialty, languages and consents (`photoConsent`, `publicProfileConsent`); withdrawing takes effect immediately | BR-24 |
| POST /me/photo, DELETE /me/photo | staff, doctor, admin | Own photo (pre-signed upload, re-encoded); showing it needs photo consent (`CONSENT_REQUIRED`) | BR-24 |

`POST /appointments` takes `patientId`; for patients it must be their `SELF` profile or an `ACTIVE` managed profile (`NOT_A_MANAGED_PATIENT` otherwise). Appointment responses include `patient` (id, display name, relation) and `bookedBy`.

## Realtime contract

Event names and payloads are listed in `medibooker-domain` → Realtime events. They are part of the contract: export their TypeScript types from `packages/api-client` and treat changes like API changes.
