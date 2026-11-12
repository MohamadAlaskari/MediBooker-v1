---
name: medibooker-domain
description: Domain knowledge for MediBooker v2 (appointment booking for a medical practice; target market not fixed) — Arabic/English glossary, entities and fields, appointment and slot lifecycles, numbered business rules (BR-xx), roles and permission matrix, realtime events, time-zone rules, and how the v1 university version behaved. Use whenever you design, build, test, review or draw screens for patients, staff, services, availability, slots, appointments, cancellations, reminders, notifications (e-mail, push, SMS), practice settings, the public practice page or practice themes.
---

# MediBooker domain

## The product

A practice publishes bookable time slots for its services (for example check-up, blood test, vaccination). Patients find a free slot and book it, then reschedule or cancel within the rules. Staff see bookings live, manage availability, book for patients who call, check patients in and record the outcome. Admins manage staff accounts, the service catalogue and the booking rules.

## Languages and markets

- UI languages: **Arabic (default, RTL)** and **English**; more will follow. Locale codes are BCP 47 (`ar`, `en`). Every user has a `locale`; e-mails, push texts and reminders use it.
- Market: **not fixed**. Everything country-specific lives in `PracticeSettings`: country, time zone, week start, weekend days, number system (Western `latn` or Arabic-Indic `arab` digits), 12/24-hour clock, insurance model, privacy overlay. Never hard-code one country's rules.

## Glossary (UI Arabic ↔ UI English ↔ code)

| Arabic UI | English UI | Code | Meaning |
|---|---|---|---|
| العيادة | Clinic | `Practice` | The medical practice: time zone, opening hours, settings |
| المريض / المريضة | Patient | `Patient` (`User` with role `PATIENT` + `PatientProfile`) | Person who books |
| موظف الاستقبال | Receptionist | `Staff` (role `STAFF`) | Front-desk staff |
| الطبيب / الطبيبة | Doctor | `Doctor` (role `DOCTOR`) | Treats patients; provider of slots |
| مدير العيادة | Clinic admin | `Admin` (role `ADMIN`) | Manages staff, services, settings |
| الخدمة | Service | `Service` | Bookable service with a duration |
| ساعات العمل | Working hours | `AvailabilityRule` | Weekly template a provider works by (bookable times) |
| أوقات الدوام | Opening hours | `OpeningHours` | When the practice is open; shown on the public page. Not the same as working hours |
| يوم استثنائي | Special day | `SpecialDay` | A date with other opening hours or closed (e.g. team training) |
| صفحة العيادة | Practice page | `PracticePage` | Public page of the practice, visible without sign-in |
| لون الهوية | Theme colour | `PracticeTheme` | The practice's colour theme (preset or custom) and logo |
| زائر | Visitor | – | Someone on the public page who is not signed in |
| موعد متاح | Available time | `Slot` | Concrete bookable time window of one provider |
| موعد | Appointment | `Appointment` | A patient's booking of a slot for a service |
| حجز | Book | book | Create an appointment |
| إلغاء | Cancel | cancel | Appointment becomes `CANCELLED` |
| تغيير الموعد | Reschedule | reschedule | Atomic cancel + book |
| تم الحضور | Checked in | `CHECKED_IN` | Patient is at the clinic |
| مكتمل | Completed | `COMPLETED` | Visit happened |
| لم يحضر | No-show | `NO_SHOW` | Patient did not come |
| التأمين الصحي | Health insurance | `insuranceType` | `PUBLIC`, `PRIVATE`, `SELF_PAY`; labels and rules per market (e.g. Germany: GKV / PKV) |
| رقم التأمين | Insurance number | `insuranceNumber` | Format validated per market |
| الموافقة | Consent | `Consent` | Recorded consent (privacy policy version, reminders) |
| تذكير بالموعد | Appointment reminder | `Reminder` | Notification before an appointment |
| الملف الطبي | Health record | `PatientRecord` (read model) | Appointments, notes, files and family links of one patient |
| ملاحظة طبية | Clinical note | `ClinicalNote` | Doctor's note on an appointment; internal or shared with the patient |
| مرفق | Attachment | `Attachment` | Image or document on an appointment |
| أفراد العائلة | Family members | `FamilyLink` | Which account manages which patient profile |
| ولي الأمر | Guardian | `FamilyLink.kind = GUARDIAN` | Manages a minor's profile |

Use these terms in UI copy, code, API and tests. Do not bring back the v1 names (mapping at the end). Arabic copy is Modern Standard Arabic, polite and short; gendered forms are chosen per patient where known, otherwise use neutral phrasing.

## Entities (v2 proposal; the `architect` owns changes)

Storage (ADR 0005, decided by the client 2026-11-02): **one PostgreSQL database per practice**. Accounts, sessions, the practice registry (slug, routing) and the membership index live in the platform database; everything a practice owns lives in that practice's own database. A `practiceId` in the table below names the logical owner; inside a practice database it is not needed as a column.

| Entity | Key fields | Notes |
|---|---|---|
| `User` | id (uuid), email (unique, case-insensitive), passwordHash, role, status (`PENDING_VERIFICATION`, `ACTIVE`, `DISABLED`), emailVerifiedAt, mfaSecret (encrypted, staff roles), locale, lastLoginAt | One login table; role data lives in profiles |
| `AccountProfile` | userId, firstName, lastName, dateOfBirth, phone, insuranceType, insuranceProvider, insuranceNumber (encrypted, only its end readable) | In the platform database, entered once at sign-up (D16 option B, RT-90); copied into `Patient` when the person joins a practice, and from then on that copy is authoritative for that practice |
| `Patient` | id, userId (nullable — children have no login), firstName, lastName, dateOfBirth, phone, phoneVerifiedAt (needed for SMS, BR-21), address, insuranceType, insuranceProvider, insuranceNumber (encrypted + blind index) | A person who can be treated. Every account has exactly one `SELF` patient and may manage more via `FamilyLink` |
| `FamilyLink` | id, managerUserId, patientId, relation (`SELF`, `CHILD`, `SPOUSE`, `PARENT`, `OTHER`), kind (`SELF`, `GUARDIAN`, `INVITED_ADULT`), status (`PENDING`, `ACTIVE`, `REVOKED`), guardianDeclaredAt, invitedAt, acceptedAt, validUntil | Delegated access; see BR-19 |
| `ClinicalNote` | id, appointmentId, patientId, authorId (doctor), body (encrypted), visibility (`INTERNAL`, `SHARED`), status (`ACTIVE`, `ENTERED_IN_ERROR`), version, previousVersionId, createdAt | Health data; append-only, see BR-16 |
| `Attachment` | id, appointmentId, patientId, uploadedById, category (`CLINICAL`, `ADMINISTRATIVE`), visibility (`INTERNAL`, `SHARED`), fileName, mimeType, sizeBytes, sha256, storageKey, scanStatus (`PENDING`, `CLEAN`, `INFECTED`, `FAILED`), createdAt, deletedAt, deleteReason | Health data; file in encrypted object storage, see BR-17 |
| `StaffProfile` | userId, title (for example "Dr."), firstName, lastName, position, isProvider, specialty (per locale), languages[], photoFileId, photoConsentAt, publicProfileConsentAt | Providers own slots. Photo and public listing only with the person's own consent (BR-24) |
| `Service` | id, name and description (per locale: `ar`, `en`), durationMinutes, bufferMinutes (BR-27), referralRequired (BR-26), color, isBookableOnline, allowedInsuranceTypes[], active, sortOrder | v1 had a hard-coded enum; v2 keeps services as data. Names, durations and hints are public (practice page) |
| `AvailabilityRule` | providerId, weekday, startTime, endTime (local wall clock), slotMinutes, serviceIds[], validFrom, validTo | Generates slots |
| `AvailabilityException` | providerId, startsAt, endsAt, reason (vacation, holiday, training) | Blocks generation |
| `Slot` | id, providerId, startsAt, endsAt (timestamptz), status (`OPEN`, `BOOKED`, `BLOCKED`), heldById (the appointment whose time, visit and buffer, the slot is part of; BR-27) | Unique (providerId, startsAt); no overlap per provider; held only while BOOKED |
| `Appointment` | id, patientId, slotId (its first slot), endsAt (the end of the visit: start and the service's duration at booking), serviceId, status, patientNote (encrypted, health data), bookedById, bookedAt, cancelledAt, cancelledById, cancelReason, rescheduledFromId, checkedInAt, completedAt | Partial unique index on slotId for active statuses |
| `PracticeSettings` | country, timezone (IANA), defaultLocale, supportedLocales, weekStart, weekendDays, numberingSystem, hourCycle, insuranceTypes + number validator, maxFutureAppointmentsPerPatient, minLeadTimeMinutes, maxHorizonDays, cancellationDeadlineHours, reminderHoursBefore, phone, email, address, appointmentChannels (`EMAIL`, `SMS`, `EMAIL_AND_SMS`), smsSenderId (≤ 11 Latin characters), reminderEnabled | One row, or one per practice if tenancy becomes multi-practice |
| `PracticePage` | practiceId, published, slug (unique, `[a-z0-9-]{3,40}`), about (per locale, ≤ 500 characters), directions (per locale: transport, parking, accessibility), showServices, showTeam, showOpeningHours, showDirections, legalNoticeUrl, privacyPolicyUrl, updatedById, updatedAt | Public data; only these fields leave the API without sign-in (BR-22) |
| `OpeningHours` | practiceId, weekday, opensAt, closesAt (local wall clock; several intervals per day possible) | Public. Independent of `AvailabilityRule` |
| `SpecialDay` | practiceId, date, closed or opensAt/closesAt, label (per locale) | Public; shown for the next 60 days. Doctor absences stay `AvailabilityException` |
| `PracticeTheme` | practiceId, preset (`TEAL`, `OCEAN`, `INDIGO`, `VIOLET`, `GRAPHITE`, `CUSTOM`), customColor (hex, nullable), scale (11 generated hex values), adjusted (bool), logoFileId (nullable), initials (≤ 2 characters), updatedById, updatedAt | BR-23; served with the practice page and the app configuration |
| `Session` | id, userId, refreshTokenHash, familyId, expiresAt, revokedAt, userAgent, ipHash | Replaces v1 PatientToken/EmployeeToken |
| `Consent` | userId, type, version, givenAt, withdrawnAt | Proof of consent |
| `AuditEvent` | id, actorId, action, entityType, entityId, at, ipHash, metadata (no health data) | Append-only |
| `Notification` | id, userId, patientId (nullable), channel (`EMAIL`, `PUSH`, `SMS`), template (e.g. `E03_APPOINTMENT_BOOKED`, `N02_REMINDER`, `S01_REMINDER`), locale, status (`SCHEDULED`, `SENT`, `DELIVERED`, `FAILED`, `CANCELLED`), dedupeKey (unique), scheduledFor, sentAt, providerMessageId, segments (SMS) | Outbox for e-mails, push and SMS; no rendered text stored (rendered at send time) |
| `NotificationPreference` | userId, type (`REMINDER`, `CLINIC_CHANGE`, `RECORD_UPDATE`, `FAMILY`), channel (`EMAIL`, `PUSH`, `SMS`), enabled, updatedAt | Unique (userId, type, channel). `CLINIC_CHANGE`/`EMAIL` and security e-mails cannot be disabled; `SMS` exists only for `REMINDER` and `CLINIC_CHANGE` (BR-21) |
| `DeviceToken` | id, userId, platform (`IOS`, `ANDROID`), token (encrypted), appVersion, locale, lastSeenAt, createdAt | Push targets; personal data; deleted on sign-out and after 60 days without use |

## Lifecycles

Appointment:

```
BOOKED ──► CHECKED_IN ──► COMPLETED
   │
   ├─────► NO_SHOW      (staff, only after the start time)
   ├─────► CANCELLED    (patient before the deadline; practice any time, with a reason)
   └─ reschedule: new BOOKED appointment (rescheduledFromId = old) + old one CANCELLED, in one transaction
```

Active statuses (the slot is taken): `BOOKED`, `CHECKED_IN`, `COMPLETED`, `NO_SHOW`. Cancelling a future appointment frees the slot again.

Slot: `OPEN ⇄ BLOCKED` (staff). `OPEN → BOOKED` when an active appointment exists, back to `OPEN` on cancellation. An `OPEN` slot that holds a cancelled appointment stays when the rules no longer want its time, because the history needs it: without a rule it can be booked for no service, and it gets a rule again when its time is wanted again.

## Business rules

Reference the IDs in code comments and test names, for example `it('BR-01 rejects a second booking for the same slot')`.

| ID | Rule | Enforced by |
|---|---|---|
| BR-01 | A slot has at most one active appointment. No double booking, also under concurrent requests. | Partial unique index + row lock in a transaction |
| BR-02 | Each patient profile (not account) has at most `maxFutureAppointmentsPerPatient` future active appointments (default 2, as in v1). Staff may override with a reason, which is audited. | Service, serialized per patient |
| BR-25 | A patient profile holds no two active appointments that overlap in time at one practice, also with different doctors; a reschedule does not count the appointment it replaces. `APPOINTMENT_OVERLAP`. | Service, under the patient's lock |
| BR-26 | A service can need a referral (`referralRequired`). Patients see it on the practice page and before they confirm a booking, the team in W12 and W7. It does not block a booking: the practice checks the letter at the visit. | UI (practice page, portal, dashboard) |
| BR-27 | A service can keep its doctor free for `bufferMinutes` (0 to 120) after each of its appointments, for cleaning or notes. An appointment holds its doctor from its start for the service's duration and then for this buffer, with whole slots; the free times offer only starts whose whole time is free, and the buffer may run past the doctor's last slot of a day. Patients never see it. | `hold.rules.ts` (M04 part 2), `TimeHolds` |
| BR-03 | Bookable window: `startsAt ≥ now + minLeadTime` (default 2 h) and `≤ now + maxHorizon` (default 90 days). Never in the past. The team booking for a patient (W7) keeps no lead time: from now on, up to the same horizon. | Service |
| BR-04 | Patients can cancel or reschedule until `cancellationDeadlineHours` (default 24 elapsed hours, ADR 0014) before the start. After that the app shows the practice phone number. Staff can always cancel, with a reason. | Service |
| BR-05 | Reschedule is atomic: book the new slot and cancel the old appointment in one transaction. If the new booking fails, the old appointment stays unchanged. | Transaction |
| BR-06 | Slots are generated from availability rules for a date range. Generation is idempotent (unique providerId + startsAt) and skips exceptions and public holidays. | Job + unique index |
| BR-07 | A slot with an active appointment cannot be blocked or deleted. Staff cancel the appointment first; the patient is notified. | Service |
| BR-08 | Patients can book only active services with `isBookableOnline` that allow their insurance type, and only in slots whose rule allows that service. The team (W7) also books a service that is not bookable online. | Service |
| BR-09 | Booking requires a verified e-mail (`ACTIVE` user) and a complete patient profile. Not for the team (W7), which books for a patient on the phone or at the desk, also for one without an account. | Guard + service |
| BR-10 | Insurance requirements come from `PracticeSettings`: which types exist, which need a provider and a number, and the number format (validator per market; e.g. Germany `PUBLIC` = letter + 9 digits). `SELF_PAY` never needs a number. | DTO + service |
| BR-11 | Only staff, doctors and admins set `CHECKED_IN`, `COMPLETED` and `NO_SHOW`, and only on the appointment's day. `NO_SHOW` only after the start time. | Service |
| BR-12 | Every state change writes an `AuditEvent` and emits a realtime event after commit. | Service + event bus |
| BR-13 | Reminders go out `reminderHoursBefore` (default 24 h) before the start, only with consent. Reminder texts contain date, time and practice only, never the service or a note. | Job |
| BR-14 | Account deletion: deactivate immediately, anonymize after the retention period. Retention periods need legal confirmation (open question). | Job |
| BR-15 | Each practice has an IANA time zone (e.g. `Asia/Riyadh`, `Europe/Berlin`). Rules use local wall-clock time; storage is UTC. Slot generation must be correct on DST change days in zones that have DST, and must respect the practice's weekend days. | Date library + tests |
| BR-16 | Clinical notes: only doctors write notes, always attached to one appointment of one patient. Notes are append-only: editing creates a new version (previous versions kept, shown as "edited"); wrong notes are marked `ENTERED_IN_ERROR`, never deleted. Visibility `INTERNAL` (default) or `SHARED` with the patient and the accounts managing them. Receptionists cannot read notes unless the clinic setting allows it. | Service + DB constraints |
| BR-17 | Attachments: doctors upload clinical files, receptionists administrative files (referral, insurance card), per appointment. Allowed: PDF, JPEG, PNG, HEIC; max size per clinic setting (default 20 MB). A file is invisible until the virus scan is `CLEAN`; images are re-encoded without metadata (EXIF/GPS). Visibility as in BR-16. Removal is a soft delete with reason, by the uploader or an admin. Every download is audited. | Upload pipeline + service |
| BR-18 | The patient record aggregates appointments, notes, files and family links of one patient. Staff reads are audited (who, when, which record). The patient view shows only `SHARED` notes and files, for the own and managed profiles. | Read model + audit |
| BR-19 | Family accounts: an account has one `SELF` patient and may manage others. Minors (below the clinic's age of majority, default 18) are added by a guardian with a guardian declaration. Adults are only linked after they accept an invitation in their own account (or with documented consent at the clinic). Managers can book, reschedule, cancel and see shared items for managed patients. When a minor reaches the age of majority, guardian access ends after a notice period unless the patient confirms. Every request that names a `patientId` is checked against the caller's active links. | Authorization layer + jobs |
| BR-20 | Notifications about a managed patient go to all active managers (and to the patient if they have an account). Texts never contain service names, note text or file contents. | Notification service |
| BR-21 | Notification preferences per type and channel. Reminders (`REMINDER`) need consent and are off until the user turns them on; changes by the clinic (moved, cancelled) always go out by e-mail, push is optional; security e-mails (new sign-in, password changed) and account e-mails (verify, reset, invitations) cannot be turned off. Push goes only to registered device tokens; a tap opens the deep link after sign-in. Appointment messages (`REMINDER`, `CLINIC_CHANGE`) use the practice's `appointmentChannels`: e-mail only, SMS only, or both. SMS only to a verified phone (`phoneVerifiedAt`), sent under `smsSenderId`, never with links; English SMS use GSM-7 characters only. If SMS is not possible (no verified number, no connected SMS provider) the message goes by e-mail instead, so `CLINIC_CHANGE` always reaches the patient on at least one channel; reminders still need consent on every channel. Account and security messages are always e-mail. Each notification is sent once per recipient and event (`dedupeKey`). Catalogue: `docs/product/notifications.md`. | Notification service + outbox job |
| BR-22 | Public practice page: only when `published`. Shows only public data: practice name, logo or initials, `about` text, "open now" computed from `OpeningHours` and `SpecialDay` in the practice time zone, opening hours, special days of the next 60 days, address, directions, phone, e-mail, languages, insurance and payment hints, online-bookable services (name, duration, hint), team members with public-profile consent (BR-24) and **free times** (start times of open slots for online-bookable services within the booking window, BR-03; filtered by doctor only for doctors with a public profile, otherwise shown under "any doctor"). Never patient data, appointment counts or who booked which time — a taken time simply does not appear. Booking starts there but requires sign-in (BR-09). Unpublished or unknown slug → 404. One URL per locale; the response is cacheable and is invalidated when any shown field changes. | Public read model + cache |
| BR-23 | Practice theme: a preset or a custom colour. For a custom colour the server generates the 11-step scale and enforces contrast in light and dark (button text on the brand colour ≥ 4.5:1, links ≥ 4.5:1, focus ring ≥ 3:1), adjusting lightness when needed and returning `adjusted: true`. Status colours, neutrals and the MediBooker logo cannot be themed. Only admins change theme and logo; every change is audited. The theme applies to app, portal, practice page, e-mails and dashboard of that practice. | Service + token generator |
| BR-24 | Staff photos and public profiles are personal data. A staff photo is shown to patients (doctor picker, team cards) only after the person's own consent (`photoConsentAt`); listing on the public page needs `publicProfileConsentAt`. Both are given and withdrawn only by the person themselves, take effect immediately (cache purge) and are audited; admins can hide a profile but not consent for someone. Without a photo the UI shows initials or a placeholder. | Service + audit |

Open questions (do not decide alone): target countries, services longer than one slot, waiting list, online payment, video consultation, several practices or locations, Hijri calendar display, which note types may be shared, whether receptionists may read notes, patient uploads, retention periods for notes and files, medical imaging (DICOM — out of scope for now), page address of the practice page (path, subdomain or own domain), reception staff by name on the public page, sign-in by phone number for SMS-only practices. Decided 2026-11-01: free times are public, the practice theme also applies to the dashboard, any custom colour with automatic contrast adjustment, appointment-message channels per practice.

## Roles and permissions

| Capability | Patient | Staff | Doctor | Admin |
|---|---|---|---|---|
| Create an account | self sign-up | invite | invite | invite |
| See services and free slots | ✓ (also visitors without an account) | ✓ | ✓ | ✓ |
| Notification settings of the practice (channels, reminders, SMS sender) | – | read | read | ✓ |
| Book, reschedule, cancel own appointments (BR-04) | ✓ | – | – | – |
| Book or cancel for any patient | – | ✓ | ✓ | ✓ |
| See appointments | own | all | all (filter: own) | all |
| Check in, complete, no-show (BR-11) | – | ✓ | ✓ | ✓ |
| Manage availability rules, block slots | – | ✓ | own | ✓ |
| See and edit patient profiles | own | ✓ (no deletion) | ✓ | ✓ |
| Manage services | – | – | – | ✓ |
| Manage staff accounts and roles | – | – | – | ✓ |
| Practice settings, audit log | – | – | – | ✓ |
| Practice page, theme and logo (BR-22, BR-23) | – | read | read | ✓ |
| Opening hours and special days | – | ✓ | – | ✓ |
| Own photo and public-profile consent (BR-24) | – | ✓ | ✓ | ✓ |
| See the public practice page | ✓ (also visitors without an account) | ✓ | ✓ | ✓ |
| Write clinical notes (BR-16) | – | – | ✓ | – |
| Read clinical notes | `SHARED` only, own + managed | setting (default no) | ✓ | – |
| Upload files (BR-17) | – | administrative | clinical + administrative | – |
| Read files | `SHARED` only, own + managed | administrative (+ clinical if setting allows) | ✓ | – |
| Patient record (BR-18) | own + managed (shared items) | ✓ (without clinical content by default) | ✓ | – |
| Manage family members (BR-19) | own account | link with documented consent | – | ✓ |

MFA is mandatory for Staff, Doctor and Admin.

## Realtime events

Namespace `/realtime`. After verifying the token, the server puts each socket into its rooms (ADR 0005 §10); clients cannot choose rooms:

- `practice:{practiceId}:staff`: staff, doctors and admins of that practice, joined only after the same membership and practice-status check as a practice-scoped request;
- `practice:{practiceId}:doctors`: the doctors of that practice (note events);
- `user:{userId}`: the signed-in user.

There is no room across practices. Every payload carries `practiceId`, so clients can call the practice-scoped paths (`/practices/{practiceId}/…`).

| Event | Rooms | Payload (IDs and times only) |
|---|---|---|
| `appointment.booked` | practice staff, user | `{ practiceId, appointmentId, slotId, providerId, startsAt }` |
| `appointment.cancelled` | practice staff, user | `{ practiceId, appointmentId, slotId, providerId, startsAt }` |
| `appointment.rescheduled` | practice staff, user | `{ practiceId, appointmentId, previousAppointmentId, slotId, providerId, startsAt }` |
| `appointment.status_changed` | practice staff, user | `{ practiceId, appointmentId, status }` |
| `slots.changed` | practice staff | `{ practiceId, providerId, from, to }` |
| `note.created`, `note.amended` | practice doctors | `{ practiceId, noteId, appointmentId, patientId }` |
| `attachment.ready`, `attachment.rejected` | practice staff, uploader (`user:{userId}`) | `{ practiceId, attachmentId, appointmentId, scanStatus }` |
| `record.shared_item_added` | user (each manager of the patient) | `{ practiceId, patientId }` → push "A new document is available in your record" (no content) |

Clients fetch details through the API. Payloads never contain names, services or notes. (v1 sent "New reservation for <patient name>" to every connected client.)

## v1 behaviour (reference only)

v1 was removed from the repository on 2026-11-02 and exists only in the git history; v2 shares no code with it. This summary is the reference for its behaviour.

- Patients: sign up (name, birth date, e-mail, phone, insurance provider, number and type, address), log in, see services, book a free slot for a service, see and cancel their reservations. Maximum 2 future reservations.
- Staff: log in; manage employees, patients and services; create slots one by one, several at once, or for a date range; see the reservation of a slot; live updates over WebSocket.
- Public pages: home, about us, our services, our team (unfinished), contact.

| v1 | v2 |
|---|---|
| `Patient` table with password | `User` (role `PATIENT`) + `PatientProfile` |
| `Employee` table with password | `User` (roles `STAFF`, `DOCTOR`, `ADMIN`) + `StaffProfile` |
| `PatientToken`, `EmployeeToken` (plain JWT stored in the DB) | `Session` with a hashed, rotating refresh token |
| `Appointment` (date + hour + boolean `status`) | `Slot` (providerId, startsAt, endsAt, status) |
| `Reservation` (patient + appointment + service) | `Appointment` (lifecycle, audit, reasons) |
| `Service.type` enum | `Service` as data: duration, translations, booking rules |
| `active` flag | `User.status` + e-mail verification |
| Public pages (home, about us, our services, our team, contact) | One public practice page per practice (`PracticePage`, BR-22; Figma PW13/PW14) |
