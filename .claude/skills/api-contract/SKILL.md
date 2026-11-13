---
name: api-contract
description: Contract-first API rules for MediBooker v2 — how the OpenAPI spec is produced from NestJS, how the typed client for web and mobile is generated, REST conventions (paths, JSON, dates, enums, pagination, errors, idempotency), backward compatibility for released mobile apps, error codes, realtime event contracts and the initial endpoint catalogue. Use when adding or changing an endpoint, DTO, error code or event, and when consuming the API from web or mobile.
---

# API contract

## Flow

1. `architect` designs the change: endpoint, DTOs, error codes, permissions.
2. `backend-engineer` implements DTOs and decorators in `apps/api`. The OpenAPI 3.1 document is generated from the code and committed as `apps/api/openapi.json`. CI fails if it is out of date.
3. `packages/api-client` is generated from it with Orval (`pnpm generate`, ADR 0012): types, fetch functions, TanStack Query hooks, zod schemas and MSW mocks. Never edit generated files.
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
| Searches | What a person types to find someone (a name, a phone number, a date of birth, an insurance number) is personal data and never in a URL: `POST /x/search` with the filters, `limit` and `cursor` in the body, 200, reads only; a `total` only on the first page, null after a cursor, so no count comes without a row shown and audited (M05) |
| Errors | `application/problem+json`: `{ type, title, status, detail, code, requestId, params?, errors?: [{ field, code, message, params? }] }`; `type` is `urn:medibooker:problem:<kebab-code>`; the status comes from the catalogue (`common/errors/error-catalog.ts`, ADR 0011) |
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

`VALIDATION_FAILED`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `RATE_LIMITED`, `JOIN_LIMIT_REACHED`, `INTERNAL_ERROR`, `SERVICE_UNAVAILABLE`, `EMAIL_NOT_VERIFIED`, `INVALID_CREDENTIALS`, `ACCOUNT_LOCKED`, `MFA_REQUIRED`, `SLOT_NOT_AVAILABLE`, `APPOINTMENT_OVERLAP`, `BOOKING_LIMIT_REACHED`, `OUTSIDE_BOOKING_WINDOW`, `SERVICE_NOT_BOOKABLE`, `PATIENT_PROFILE_INCOMPLETE`, `CANCELLATION_DEADLINE_PASSED`, `INVALID_STATUS_TRANSITION`, `SLOT_HAS_APPOINTMENT`, `IDEMPOTENCY_KEY_REUSED`, `RATE_LIMITED`, `NOT_A_MANAGED_PATIENT`, `GUARDIAN_DECLARATION_REQUIRED`, `INVITATION_EXPIRED`, `NOTE_NOT_EDITABLE`, `FILE_TOO_LARGE`, `FILE_TYPE_NOT_ALLOWED`, `FILE_REJECTED`, `FILE_NOT_READY`, `NOTIFICATION_PREFERENCE_LOCKED`, `PHONE_NOT_VERIFIED`, `SMS_NOT_ENABLED`, `VERIFICATION_CODE_INVALID`, `THEME_COLOR_INVALID`, `PRACTICE_SLUG_TAKEN`, `CONSENT_REQUIRED`.

## Endpoint catalogue (initial proposal)

The roles of the team are capabilities (D17, ADR 0017): **team** is every active member; **planning** is a member with the base role `STAFF` (the practice team) or with practice management; **management** is a member with practice management. A doctor without practice management plans only its own schedule. `@PracticeScoped('id', { staff: 'team' | 'planning' | 'management' })` asks for one of them.

| Method and path | Roles | Purpose | Rules |
|---|---|---|---|
| POST /auth/register | public | Patient sign-up; ASCII addresses only, the same answer for a known address | BR-10 |
| POST /auth/verify-email | public | Confirm the e-mail address, with the token and the password of the account | BR-09 |
| POST /auth/verify-email/resend | public | A new link; the same answer whether the account exists or not | BR-09 |
| POST /auth/login | public | Login, also before the address is confirmed (RT-89); an account with a second factor sends `code` or `recoveryCode` in the same request: without it `MFA_CODE_REQUIRED` and no session, a wrong or used one `MFA_CODE_INVALID` | ADR 0004 §7 |
| POST /me/mfa/totp | team (an active STAFF index row) | Start the authenticator app: secret and otpauth URI; `MFA_ALREADY_ENABLED` when in force, FORBIDDEN without the team | ADR 0004 §7 |
| POST /me/mfa/totp/confirm | any | Put it in force with a first code: ten recovery codes once, and the session replaced with `amr` `pwd` and `otp`, in cookies for a browser and as tokens only for a Bearer client | ADR 0004 §7 |
| GET /practices/{practiceId}/me/membership | team | The own base role, practice management (`managesPractice`, D17) and the doctor the account is (`providerId`, M04), for the dashboard; `MFA_REQUIRED` without the second factor | A04 |
| POST /auth/refresh | refresh token | Rotate tokens | |
| POST /auth/logout | any | Revoke the session | |
| POST /auth/password/forgot, POST /auth/password/reset | public | Password reset | |
| GET, PATCH /me | any | Own account | |
| GET, PUT /me/profile | any | Own details and insurance (D16 option B); 404 until entered; the insurance number only by its end | BR-10 |
| DELETE /me/unconfirmed | any | Delete an own account that was never confirmed; otherwise 409 | RT-90 |
| GET /me/export, DELETE /me | patient | DSGVO export and deletion | BR-14 |
| GET /me/appointments | patient | What is to come across the own practices, soonest first; `unavailablePractices` names the rest with `UNAVAILABLE`, `TIMEOUT` or `LIMIT`; 30 a minute per address | ADR 0005 §9.1 |
| GET /services | public | Bookable services | BR-08 |
| GET /practices/{practiceId}/services; POST …/services, PATCH …/services/{serviceId} | read: team; change: management | W12, W13: every service, also the archived ones (`active: false`, never deleted), with the doctors whose current rules offer it; a name in every language of the practice, a note per language, duration, buffer after (0 to 120), referral, online, insurance types; `PUT …/services/{serviceId}/providers` names the doctors who offer it through their working hours; audited | BR-08, BR-26, BR-27 |
| GET /practices/{practiceId}/availability?serviceId&providerId&from&to | any signed-in account with a confirmed address, of a published practice (B07, D19; public until then) | Days with free times (`hasFreeTimes` per day; no counts of booked times); at most 42 days, by default the next 42; `Cache-Control: no-store`; rate-limited, at most two under way per account | BR-03, BR-22 |
| GET /practices/{practiceId}/free-times?serviceId&providerId&date | as `availability` (B07, D19) | Free start times of one day, each only `{ startsAt }`: no slot id, by which two answers could be compared (BR-24); `providerId` only for doctors with a public profile, otherwise grouped as any doctor; `Cache-Control: no-store`; rate-limited, at most two under way per account | BR-03, BR-22, BR-24 |
| POST /practices/{practiceId}/appointments | patient, confirmed (for self) | Book a time: serviceId, startsAt, optional providerId and patientNote; `Idempotency-Key` required; 10 a minute per address, and 429 above the account's share of the connections. The answer's providerId is null unless the doctor's profile is public (BR-24). Staff with patientId follow with M items | BR-01, 02, 03, 08, 09 |
| GET /practices/{practiceId}/desk/day?date | team (both factors) | The team's day: appointments in the order of time (at most 500, then `truncated`), counts of the whole day, free times left, `today` and `now`; an audit event per appointment shown | BR-11, BR-18 |
| POST /practices/{practiceId}/desk/appointments/search { from, to, providerId, serviceId, patientId, status, query, limit, cursor } | team | W5: the appointments of up to 92 days in the order of time, a page at a time, `total` on the first page; an audit row per appointment shown, once in five minutes per person; 60 a minute per address | BR-18 |
| GET /practices/{practiceId}/desk/catalog | team | The doctors and services of the practice, for filters and booking, and its insurance rules for a new patient | |
| GET /practices/{practiceId}/desk/week?providerId&from | team | W2: seven days of one doctor: every slot with the appointment that holds it (a cancelled one holds none; `continuation` for the rest of its visit and buffer, BR-27) and the absences with their reason; an audit row per appointment shown, once in five minutes per person | BR-18 |
| GET /practices/{practiceId}/desk/availability?serviceId&providerId&from&to, GET …/desk/free-times?serviceId&providerId&date | team | W7: free days and times for the team, as the public routes answer them, but every active service and doctor and from now on (no lead time) | BR-03, BR-08 |
| POST /practices/{practiceId}/desk/appointments { patientId, serviceId, startsAt, providerId, limitOverrideReason } | team | W7: book a time for a patient of the practice; `Idempotency-Key`; 30 a minute per address; BR-01 and BR-25 as for a patient's own booking, BR-02 too unless `limitOverrideReason` says why to book past the limit (sealed, for the team only, kept only past the limit, audited `appointment.book_by_practice_over_limit`); the row of the desk; audited (`appointment.book_by_practice`) | BR-01–03, BR-08, BR-25 |
| POST /practices/{practiceId}/desk/patients | team | W7: a patient without an account, with what the practice asks (BR-10); the same name and date of birth or the same insurance number answers 409 `PATIENT_MAY_EXIST` unless `confirmDuplicate`; 20 a minute per address; audited (`patient.add_by_practice`, `patient.add_by_practice_despite_match`) | BR-10 |
| GET /practices/{practiceId}/me/appointments?scope=upcoming\|past&limit&cursor | patient | Own appointments in this practice, with the history; `limit` at most 100 | |
| GET /practices/{practiceId}/appointments/{id} | owner | Details, never the note; another patient's is 404 | BR-24 |
| GET /practices/{practiceId}/desk/appointments/{id} | team | One appointment with the patient's note, contacts, age and insurance provider, and the team's reasons (`cancelReason`, `limitOverrideReason`); the read is audited | RT-93, BR-18 |
| POST /practices/{practiceId}/appointments/{id}/cancel | owner before the deadline | Cancel; a second cancel answers the same; 10 a minute per address | BR-04 |
| POST /practices/{practiceId}/desk/appointments/{id}/cancel | team | A cancel by the practice at any time with `cancelReason` (sealed, for the team only); the time is free again; a retry answers alike, and an appointment the patient cancelled or moved is `INVALID_STATUS_TRANSITION` | BR-04, BR-07 |
| POST /practices/{practiceId}/appointments/{id}/reschedule | owner before the deadline, confirmed (the practice: with W7) | Atomic move to startsAt with an optional providerId: a new appointment, the old one cancelled; `Idempotency-Key` required; 10 a minute per address | BR-04, BR-05 |
| POST /practices/{practiceId}/desk/appointments/{id}/check-in, /complete, /no-show | team | BR-11: on the appointment's day, `NO_SHOW` from its start, `INVALID_STATUS_TRANSITION` otherwise; a retry answers alike | BR-11 |
| GET, PUT /practices/{practiceId}/providers/{providerId}/working-hours | planning, doctor (own; another or none 404) | W14: a doctor's week from today (intervals, start times every, services); the PUT ends the rules of before and makes the free times anew, a booked or blocked time stays | BR-06, BR-07, BR-08 |
| GET, POST, DELETE /practices/{practiceId}/providers/{providerId}/absences | planning, doctor (own) | Whole days or a time of one day with a reason; a POST counts the booked appointments inside; the free times follow | BR-06 |
| POST /practices/{practiceId}/slots/generate | planning | Every doctor's free times anew from the rules, up to the horizon of BR-03; idempotent; 6 a minute | BR-06 |
| PATCH /practices/{practiceId}/slots/{slotId} { status } | planning, doctor (own) | Block a free time or free a blocked one; a time an appointment holds is 409 `SLOT_HAS_APPOINTMENT`; a retry answers alike | BR-07 |
| POST /practices/{practiceId}/desk/patients/search { query, insuranceType, limit, cursor }, GET …/desk/patients/{id} | team | W8: patients found by a name in Arabic or Latin letters however written (the stored `search_name`), phone digits, a date of birth or an insurance number (blind index only), `total` on the first page, 60 a minute per address; one patient's record with the next and last appointments and `hasAccount`; reads audited (`patient.list`, `patient.read`, and `appointment.list` for the record's appointments) | BR-18 |
| PATCH /practices/{practiceId}/desk/patients/{id} | team | RT-97, Art. 16: correct a patient without an account (what is left out stays, a null phone removes it, the insurance checked when it changes); a profile of an account, or a child's, is 409 `PATIENT_HAS_ACCOUNT`; a match with another patient 409 `PATIENT_MAY_EXIST` unless `confirmDuplicate`; 30 a minute per address; audited (`patient.update_by_practice`, `…_despite_match`); answers the `PatientDto` | BR-10 |
| GET /practices/{practiceId}/desk/patients/{id}/export | management | RT-97, Art. 15: everything the practice keeps about one patient, the whole insurance number and every appointment with the note and the team's reasons, a doctor named only with a public profile (BR-24); five a minute per address; audited (`patient.export`, `appointment.export`) | BR-18 |
| GET /practices/{practiceId}/staff | management | W15: the team (name, e-mail, base role, practice management, the linked doctor, second factor, active, `you`) and the doctors with the membership linked to each | D17 |
| PUT /practices/{practiceId}/staff/{membershipId}/role { role, managesPractice, providerId } | management | A base role (`STAFF`, `DOCTOR`), practice management, and for a doctor its link: null takes it away, left out keeps it, with `STAFF` it goes; `LAST_PRACTICE_MANAGER`, `DOCTOR_ALREADY_LINKED`, `CONFLICT` for a deactivated member; 30 a minute; audited; E13 to the member unless the change is one's own | D17 |
| POST /practices/{practiceId}/staff/{membershipId}/deactivate, …/reactivate | management | Ends a member's access on its next request (DISABLED, its doctor link goes, every session of the account ends, E14), or, after ending every session of the account, gives it back with the role it had; never one's own (`NOT_ON_YOURSELF`), and the last manager stays (`LAST_PRACTICE_MANAGER`); audited | D17 |
| POST /practices/{practiceId}/staff/{membershipId}/second-factor/reset | management | Removes a lost authenticator app and the recovery codes and ends every session (E15); a new app at the next sign-in; never one's own; audited in the platform and the practice | D17, RT-96 |
| POST /practices/{practiceId}/staff/invitations | management | Invitations (E09) | M03 part 2 |
| GET, PATCH /settings | management (GET also team) | Booking rules, practice data | |
| GET /audit-events | management | Audit log, with an export for the data protection officer | D18 |
| GET /app-config | public | Minimum app version, feature flags | |
| POST /practices/{practiceId}/me/patients | confirmed account | Join: copies the account's details into the practice and names what is missing (D16); the sixth new practice in 24 hours is `JOIN_LIMIT_REACHED` | BR-09, BR-10 |
| GET /practices/{practiceId}/me/patients | patient | The caller's profiles in this practice; 404 before a join | BR-10 |
| GET, PATCH /practices/{practiceId}/me/patients/{patientId} | patient (own) | The own profile; the number is masked | BR-10 |
| GET /me/practices | account | The practices of the account with the capacity, from the platform database | |
| GET /me/patients | patient | Own (`SELF`) and managed patient profiles | BR-19 |
| POST /me/patients | patient | Add a child (with `guardianDeclaration: true`) | BR-19 |
| POST /me/patients/invitations | patient | Invite an adult family member (by e-mail or phone) | BR-19 |
| POST /family-invitations/{token}/accept | invited user | Accept being managed | BR-19 |
| DELETE /me/patients/{patientId} | patient | Unlink a managed profile | BR-19 |
| GET /me/patients/{patientId}/record | patient (own/managed) | Visits with `SHARED` notes and files | BR-18 |
| GET /patients/{id}/record | staff, doctor | Full record (clinical parts per role); audited | BR-18 |
| GET /appointments/{id}/notes, POST /appointments/{id}/notes | doctor (read also: setting) | List / create clinical notes | BR-16 |
| PATCH /notes/{id} | author doctor | Amend → new version (`previousVersionId`) | BR-16 |
| POST /notes/{id}/entered-in-error | author doctor, management | Mark as wrong (no delete) | BR-16 |
| POST /appointments/{id}/attachments | doctor, staff | Start upload → `{ attachmentId, uploadUrl (pre-signed, ≤ 5 min) }` | BR-17 |
| POST /attachments/{id}/complete | uploader | Upload finished → scan starts (`PENDING`) | BR-17 |
| GET /attachments/{id}/download-url | allowed readers | Short-lived signed URL (`CLEAN` only); audited | BR-17 |
| PATCH /attachments/{id} | uploader, doctor | Change visibility | BR-17 |
| DELETE /attachments/{id} | uploader, management | Soft delete with reason | BR-17 |
| GET, PATCH /me/notification-preferences | any | Read or change push / e-mail / SMS per message type; locked types → `NOTIFICATION_PREFERENCE_LOCKED`; SMS without a verified phone → `PHONE_NOT_VERIFIED`; practice whose `appointmentChannels` exclude SMS (or e-mail) → `SMS_NOT_ENABLED` | BR-21 |
| GET, PATCH /settings/notifications | management (GET also team) | `appointmentChannels` (`EMAIL`, `SMS`, `EMAIL_AND_SMS`), reminder on/off and `reminderHoursBefore`, `smsSenderId`; read-only `smsProviderStatus` (`NOT_CONNECTED`, `ACTIVE`) | BR-13, BR-21 |
| POST /settings/notifications/test | management | Send a test reminder to the person's own e-mail and verified phone | BR-21 |
| POST /me/phone/verification, POST /me/phone/verification/confirm | patient | Send a one-time code by SMS (S05) / confirm it (`VERIFICATION_CODE_INVALID`); sets `phoneVerifiedAt` | BR-21 |
| POST /me/devices | patient | Register or refresh a push token `{ platform, token, appVersion, locale }` (idempotent per token) | BR-21 |
| DELETE /me/devices/{id} | patient | Remove a push token (the app also calls it on sign-out) | BR-21 |
| POST /auth/sessions/revoke-all | public: the single-use token of a security e-mail (E10, E11, E12), valid a week | "This was not me": end every session, stop the password, forget the browsers, send a reset link; the second factor stays; `INVALID_TOKEN` otherwise | ADR 0004 §8 |
| GET /me/sessions | any | The own sign-ins that still work, newest first: device, sign-in, last refresh, current, second factor | ADR 0004 §8 |
| DELETE /me/sessions/{sessionId} | any | End one own sign-in; `NOT_FOUND` for another account's | ADR 0004 §8 |
| POST /me/sessions/revoke-others | any | End every own sign-in but this one | ADR 0004 §8 |
| GET /public/practices?limit&cursor | public | Cursor list of the current slugs of published, active practices in a served market, from the registry alone, no `lastmod`; the sitemap reads it | BR-22 |
| GET /public/practices/{slug} | public | Practice page: published profile fields, opening hours, special days (next 60 days), online-bookable services, team members with consent (name, specialty, languages, `photoUrl` or null), theme (preset, 11-step scale, logo URL, initials), locales. Unpublished → 404 | BR-22, BR-23, BR-24 |
| GET /providers?serviceId | patient | Doctors for the doctor picker: `displayName`, `photoUrl` (only with photo consent, else null → initials) | BR-24 |
| GET, PATCH /settings/practice-page | management (GET also team) | Publish, slug (`PRACTICE_SLUG_TAKEN`), about and directions per locale, sections shown, legal links | BR-22 |
| GET, PUT /practices/{practiceId}/opening-hours; GET, POST, DELETE …/special-days | read: team; change: planning | W20: the PUT replaces the whole week, an overlap is the field error `OVERLAPS_EXISTING` on `intervals[i]` (the EXCLUDE); a special day from today to two years ahead, one per date (`ALREADY_EXISTS` on `date`); audited | BR-22 |
| GET, PATCH /settings/theme | management (GET also team) | Preset or custom hex (`THEME_COLOR_INVALID`); the response contains the generated scale and `adjusted` | BR-23 |
| POST /settings/logo, DELETE /settings/logo | management | Logo upload via pre-signed URL (PNG/WebP), then scan and re-encoding as for attachments | BR-23 |
| GET, PATCH /me/public-profile | team | Own specialty, languages and consents (`photoConsent`, `publicProfileConsent`); withdrawing takes effect immediately | BR-24 |
| POST /me/photo, DELETE /me/photo | team | Own photo (pre-signed upload, re-encoded); showing it needs photo consent (`CONSENT_REQUIRED`) | BR-24 |

`POST /appointments` takes `patientId`; for patients it must be their `SELF` profile or an `ACTIVE` managed profile (`NOT_A_MANAGED_PATIENT` otherwise). Appointment responses include `patient` (id, display name, relation) and `bookedBy`.

## Realtime contract

Event names and payloads are listed in `medibooker-domain` → Realtime events. They are part of the contract: export their TypeScript types from `packages/api-client` and treat changes like API changes.
