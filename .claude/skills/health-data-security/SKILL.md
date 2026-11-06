---
name: health-data-security
description: Security and privacy baseline for MediBooker v2, which processes health data (DSGVO/GDPR Art. 9) — data classification, authentication and sessions, authorization (role + ownership), input validation, encryption, logging and audit without PII, realtime security, secrets and supply chain, web and mobile specifics, the v1 security lessons, and a review checklist with severities. Use when designing or implementing anything with personal or health data, auth, permissions, logging, realtime, infrastructure or third-party services, and for every security review.
---

# Health-data security baseline

This is an engineering baseline, not legal advice. The target market is not fixed yet: apply this GDPR-level baseline everywhere and add the overlay of each country the client launches in (§2). Retention periods, records of processing, the data protection impact assessment (DPIA), data residency and processor contracts must be confirmed by the client's data protection officer or legal counsel for each market.

## 1. Data classification

Classify every new field, log line and event.

| Class | Examples | Rules |
|---|---|---|
| Health (Art. 9) | booked service, appointment note, appointment history, no-show history, clinical notes, uploaded images and documents, family relations to patients | Encrypt free text and files. Never in logs, analytics, push texts, e-mail subjects, URLs or realtime payloads. Access is audited. |
| Personal | name, birth date, e-mail, phone, address, insurance provider | Need-to-know access. Never in logs or URLs. |
| Sensitive identifier | insurance number | Field encryption + blind index. Shown masked (`A12••••789`). |
| Secret | password, tokens, MFA secret, keys | Hash (passwords, tokens) or encrypt (MFA secret). Never logged or returned. |
| Public | service catalogue, opening hours, special days, published practice page fields, practice theme and logo; a staff member's name, photo and specialty only after their consent (BR-24) — before that they are Personal | No restrictions once published; withdrawal of consent must take effect immediately |

## 2. Legal frame and what it means for engineering

Baseline (GDPR terms, applied in every market):

- Special-category data (GDPR Art. 9): health data needs a legal basis (treatment contract; explicit consent for extras such as reminders).
- Privacy by design and by default (Art. 25): minimal fields, shortest retention, opt-in for reminders, no marketing.
- Security of processing (Art. 32): encryption in transit and at rest, access control, logging, tested backups, regular security testing.
- Data subject rights (Art. 15, 17, 20): patients can export (`GET /me/export`) and delete (`DELETE /me`) their data.
- Processors (Art. 28): a data processing agreement with every processor (hosting, e-mail, SMS, push, error tracking). No third-party analytics SDKs in the patient app.
- Breach notification (Art. 33/34, 72 hours): monitoring and audit logs make detection possible.

Country overlays (examples to verify with counsel before launch; the list is not exhaustive):

| Market | Laws to check | Typical engineering impact |
|---|---|---|
| EU / Germany | GDPR, BDSG § 22, StGB § 203 (medical confidentiality) | EU hosting, processor contracts, staff confidentiality |
| Saudi Arabia | Personal Data Protection Law (PDPL) and implementing regulations; health-sector rules | Health data is sensitive; cross-border transfer restrictions |
| United Arab Emirates | Federal PDPL; Federal Law No. 2 of 2019 on ICT in health fields | Health data generally stored and processed inside the UAE |
| Jordan | Personal Data Protection Law No. 24 of 2023 | Consent and transfer rules |
| Egypt | Personal Data Protection Law No. 151 of 2020 | Licensing and transfer rules for sensitive data |

Data residency is decided per market before infrastructure is built: one deployment region per market, no replication of patient data across regions.

## 3. Authentication

- Passwords: argon2id with at least the OWASP parameters (m = 19 MiB, t = 2, p = 1). Minimum length 10 for patients and 12 for staff, check against known breached passwords, no composition rules, allow paste and password managers.
- E-mail verification before the first booking; a sign-in does not need it (the user's decision, accepted risk RT-89). Verification and reset tokens are single-use, stored hashed, expire after 30 minutes.
- Login: one generic error ("The e-mail address or the password is not correct." / "البريد الإلكتروني أو كلمة المرور غير صحيحة."). An attempt is counted before its password is checked, under a lock of the account's row, so a burst of guesses cannot pass the wait. Rate limits per IP and per account with exponential backoff. Register and password reset give the same response whether the account exists or not.
- MFA (TOTP) is mandatory for Staff, Doctor and Admin. Recovery codes are stored hashed.
- Tokens: short-lived access JWT (≤ 15 min, asymmetric signature, claims `iss`, `aud`, `sub`, `sid`, `amr` and a `kid`; no role, because a role changes and belongs to one practice). Opaque random refresh token (256 bit), stored as a SHA-256 hash in `Session`, rotated on every use; reuse of an old refresh token revokes the whole token family. Signing keys come from the secret store and survive restarts (v1 generated a new secret at every start).
- Web: tokens only in `HttpOnly; Secure; SameSite=Strict` cookies, plus CSRF protection. Nothing in `localStorage`.
- Mobile: tokens in Keychain/Keystore (`expo-secure-store`). Biometric unlock is optional.
- Logout and password change revoke sessions. A practice admin disables a membership, effective on the next request; revoking all sessions is an account-level action of the user.

## 4. Authorization

- A global guard denies by default. `@Public()` is an explicit, reviewed exception.
- Two checks on every request: the role, which comes from the active membership in the resolved practice (`@PracticeScoped('id', { staffRoles })`, from B01 and A04) and never from the token, and ownership or scope in the service ("this appointment belongs to this patient").
- The user's identity comes only from the verified token (`@CurrentUser()`), never from the body, query or path. v1 trusted IDs sent by the client.
- Resources of other users return 404, not 403, so their existence is not revealed.
- IDs are UUIDs, never sequential numbers.
- Every staff read of a patient record writes an `AuditEvent` (who, when, which record).
- Each new endpoint has tests for: no token (401), wrong role (403), another user's resource (404), own resource (200).

## 5. Input and output

- Validate every input on the server: whitelist DTOs, reject unknown fields, length limits, enums, formats. Client-side validation is only for UX.
- No mass assignment. Map DTO fields explicitly. (v1 spread `...updates` from the request body into the database.)
- Responses use explicit response DTOs. Never return ORM entities (v1 could leak password hashes).
- Errors are RFC 9457 problem+json with a stable `code`. No stack traces, SQL or personal data in responses.
- Limit request body size and page size (`limit ≤ 100`).

## 6. Data protection

- TLS 1.2+ everywhere, HSTS. The database is never reachable from the internet (v1's MySQL host was public).
- Encryption at rest for database volumes and backups. Application-level encryption (AES-256-GCM, keys in a KMS or secret manager, versioned keys) for `insuranceNumber`, `patientNote` and `mfaSecret`. Use an HMAC blind index where uniqueness or search is needed.
- Backups: encrypted, in the market's required region, restore tested regularly.
- Retention: automatic deletion or anonymization jobs; periods are configuration, not code.
- Minimization: collect only what a feature needs. Question every new field.

## 7. Logging, monitoring, audit

- Structured logs (pino) with redaction and an allowlist of fields. Log IDs, not names. Never log request bodies of auth or patient endpoints.
- Append-only `AuditEvent` for: login, logout, MFA changes, role changes, every appointment state change, staff reads of patient records, exports and deletions.
- Alerts for spikes in failed logins, refresh token reuse, 5xx errors and unusual export volume.
- Error tracking (in the market's region) with PII scrubbing. No session replay on screens with patient data.

## 8. API and transport hardening

- `helmet` security headers, a strict CSP for the web app, a CORS allowlist (v1 allowed every origin).
- Rate limits, stricter on auth, booking and search endpoints.
- `Idempotency-Key` header on `POST /appointments` and reschedule (mobile clients retry).
- No tokens or personal data in URLs or query strings; they end up in logs and browser history.
- Swagger UI only outside production, or behind admin authentication.
- Booking integrity: transaction + row lock + partial unique index (BR-01, BR-02, BR-05).

## 9. Realtime

- Authenticate the socket handshake with the access token. Disconnect when the token expires or the session is revoked.
- The server assigns rooms. Clients cannot join rooms themselves.
- Payloads contain IDs only. Clients fetch details through the authorized API.
- Never re-broadcast messages sent by clients (v1 forwarded every client message to all clients).

## 10. Secrets, configuration, supply chain

- Configuration from environment variables, validated at startup (fail fast). Commit only `.env.example`.
- Secret scanning (gitleaks) in pre-commit and CI. A leaked secret is rotated immediately; deleting it from git history is not enough.
- The git history still holds the v1 database credential (one credential, two findings). It is not rotated and stays valid and public: the user declined U1 on 2026-11-04 and accepted the risk (`docs/architecture/09-risks-and-decisions.md`). The acceptance covers the credential only. Not verified: whether real people's data ever reached the v1 database (it had a public sign-up and stored contact, insurance and booking data; the seed data came from Faker). If real data is ever confirmed there, its controller assesses a breach under GDPR Art. 33/34 (notification within 72 hours of awareness); this decision does not replace that.
- From F02, `.gitleaksignore` holds exactly the two commit-qualified fingerprints of these findings, under a dated comment, and the scans fail closed when it differs from the pinned list: gitleaks reads the file from the scan root, and a commit-less entry would silence a finding in every commit. A live secret is never added to `.gitleaksignore`; the U1 credential is the only accepted exception. Any other finding is rotated first; if it already reached the pushed history, its commit-qualified fingerprint is then added with a dated comment that names the rotation, in a commit the security-reviewer approves, which also updates the pinned list. A new finding in the v1 history (commits before L00), for example after a gitleaks upgrade or a rule change, goes to the user as a follow-up of U1 and needs a new dated user decision; so does re-recording the two U1 findings after a rule rename.
- Commit the lockfile. Use Renovate or Dependabot, run `pnpm audit` in CI, pin GitHub Actions to commit SHAs, produce an SBOM for releases.
- Least privilege: separate database users for migrations and for the running app.

## 11. Web and mobile specifics

- Mobile: no health data in push texts or calendar entries; consider hiding sensitive screens in the app switcher; clear the query cache and secure storage on logout; deep links require login and validated parameters; no cleartext traffic; no third-party trackers.
- Web: no `dangerouslySetInnerHTML` with user data; no inline scripts (CSP); `rel="noopener noreferrer"` on external links; automatic logout after inactivity on the staff dashboard (shared front-desk computers); self-host fonts and assets (no third-party CDNs that receive users' IP addresses).
- Bidirectional text: render user-supplied text with bidi isolation (`<bdi>`, `unicode-bidi: isolate`) so Arabic/Latin mixing cannot reorder surrounding UI (e.g. spoof a name or a time).

## 11a. Clinical notes, files and family access

**Clinical notes (BR-16)**
- Field-level encryption of the note body; versions are immutable rows; no hard delete (`ENTERED_IN_ERROR` instead).
- Role check *and* clinic setting for receptionist read access; patient access only to `SHARED` notes of own or managed profiles.
- Every read of a note list is part of the audited record access.

**File uploads (BR-17)** — treat every file as hostile:
- Upload directly to private object storage with a pre-signed PUT URL (≤ 5 min, exact size and content type); the API never proxies large bodies.
- Random storage keys (UUID), never the user's filename; keep the sanitized original name only as metadata.
- Allowlist by magic bytes, not by extension or the client's `Content-Type`: PDF, JPEG, PNG, HEIC. No SVG, HTML, Office macros or archives.
- Virus scan (e.g. ClamAV) before the file becomes visible; `INFECTED` files are quarantined and the uploader is told.
- Re-encode images server-side (removes EXIF/GPS and polyglot payloads); generate thumbnails from the re-encoded image.
- Server-side encryption with keys from the KMS; bucket in the market's region; versioning on, public access blocked.
- Downloads only through short-lived signed URLs with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`; PDFs are shown in a sandboxed viewer, never as same-origin HTML.
- Size limits enforced at the storage level and in the API; per-user upload rate limits.
- Every upload, download, visibility change and deletion writes an `AuditEvent`.

**Family access (BR-19)**
- Delegated access is data, not a role: every endpoint that takes a `patientId` checks the caller's `ACTIVE` `FamilyLink` (or staff role). Missing link → 404. Test it like ownership (IDOR).
- Adults cannot be linked without their acceptance; invitation tokens are single-use, hashed, expire after 7 days.
- Guardian declarations are stored with timestamp and account; access for a minor ends automatically after the age of majority plus notice period.
- A manager sees only `SHARED` clinical items; the managed adult can revoke the link at any time.

## 11b. Notifications (e-mail, push, SMS) — ADR 0001, BR-13, BR-20, BR-21

- Content: date, time, clinic and first name only. No service, doctor, note, file name or content — also not in subjects, preview texts, push titles, `.ics` files or link URLs (links carry opaque IDs).
- Push payload: message type and IDs plus the localized title and body; the app loads details through the API after sign-in. Deep links validate their parameters.
- Device tokens are personal data: encrypted at rest, never logged, deleted on sign-out and after 60 days without use.
- E-mail: no tracking pixels or click tracking; plain-text part; SPF, DKIM and DMARC on the sender domain; action links use single-use, hashed tokens (verify and reset 30 minutes, invitations 7 days).
- Preferences are enforced server-side (BR-21); a locked type cannot be disabled through the API.
- "New sign-in" e-mail: the "This was not me" action revokes all sessions and forces a password reset.
- E-mail, push and SMS providers are processors: data processing agreement and the market's region.
- Channels per practice (e-mail only, SMS only, both): when SMS is not possible the message falls back to e-mail, so changes by the clinic always arrive; account and security messages stay e-mail.
- SMS: only to a verified phone number; verification codes are single-use, stored hashed, expire after 10 minutes, rate-limited per number and per account (SMS pumping and toll fraud). No links in SMS. Phone numbers and SMS texts never appear in logs; delivery receipts are matched by provider message ID. Changing the phone number requires a new verification and a notice e-mail.

## 11c. Public practice page, staff photos and themes — BR-22, BR-23, BR-24, ADR 0002

- The public endpoint (`GET /public/practices/{slug}`) is an explicit `@Public()` exception: read-only, its own response DTO with published fields only (no patient data, no appointment counts, no staff e-mail or phone), rate-limited, cacheable (`Cache-Control: public`, ETag, `Vary: Accept-Language`).
- Free times are public (`GET /availability`, `GET /slots`): only free start times, never who booked a time or how many bookings exist; doctors appear by name only with a public profile (BR-24); short cache (30 s), rate limits per IP and bot protection against scraping. Booking still needs sign-in, an `Idempotency-Key` and BR-01/BR-02, so public times cannot be reserved anonymously.
- Next.js (ADR 0003): strict CSP with per-request nonces from middleware; pages with personal or health data are never cached by Next.js or a CDN (`no-store`); only the public practice page may be cached.
- Public pages set no cookies and load no third-party scripts, fonts, maps or analytics; "Open in maps" is a plain link (`rel="noopener noreferrer"`). This keeps visitors' IP addresses away from third parties and avoids a consent banner.
- Staff photos and public profiles: consent from the person themselves, stored with timestamp and text version, revocable; on withdrawal the page cache and CDN copies are purged. Photos are re-encoded (no EXIF/GPS) like other images.
- Logo upload (admin only): PNG or WebP only — no SVG (scripts, external references) — checked by magic bytes, ≤ 1 MB, virus-scanned, re-encoded, served with the correct `Content-Type` and `nosniff`.
- Theme input: only `^#[0-9A-Fa-f]{6}$`; the server generates the CSS values. Never interpolate user text into CSS, HTML attributes or e-mail styles.
- Slug: lowercase `[a-z0-9-]{3,40}`, reserved words blocked (`admin`, `api`, `login`, …); a changed slug keeps a redirect so old links do not land on another practice.
- The page tells visitors not to send medical details by e-mail. A contact form is out of scope; if it ever comes, it is health data.
- Legal notice and privacy policy links are required per market and come from the practice settings.

## 12. v1 lessons (must stay fixed)

v1 (an Angular client and an Express API) was removed from the repository on 2026-11-02 and exists only in the git history; v2 shares no code with it. Its failures stay here as lessons, and each v2 rule applies in full.

| v1 problem | Where in v1 | v2 rule |
|---|---|---|
| Database password in source code and git history | API database configuration and a committed `.env` file | §10 |
| New random JWT secret at every start | Token service | §3 |
| Plain-text tokens stored in the database | Patient and employee token tables | §3 |
| No role checks: any logged-in patient could list all patients | Patient routes | §4 |
| Reservation routes and service update without authentication | Reservation and service routes | §4 |
| Double booking possible (check, then write, no lock) | Reservation controller | §8, BR-01 |
| Reschedule deletes before it books; the old slot can be lost | Reservation update | BR-05 |
| Mass assignment via `...updates` | Reservation update | §5 |
| Implicit global variable `patientId` shared between requests | Reservation create | Strict TypeScript + lint |
| Crash when the `Authorization` header is missing | Several controllers | Global guard |
| Patient names broadcast to every WebSocket client | WebSocket middleware | §9 |
| CORS open to every origin | Server setup | §8 |
| No input validation | All controllers | §5 |

## 13. Review checklist

Severity: **Critical** (exploitable now, data exposure), **High** (likely exploitable, or a core control is missing), **Medium** (missing defence in depth), **Low** (hardening), **Info**.

- [ ] Every new endpoint: guard, role and ownership; tests for 401, 403, 404 and 200
- [ ] Identity only from the token; no client-supplied IDs used as identity
- [ ] DTO validation with whitelist; explicit response DTOs; no mass assignment
- [ ] No personal or health data in logs, errors, URLs, events, push texts or analytics
- [ ] Health and sensitive fields encrypted; insurance number masked in the UI
- [ ] Transactions and constraints for booking and other races; idempotency where clients retry
- [ ] Secrets only from the environment; nothing new committed; gitleaks clean
- [ ] Dependencies: no new high or critical advisories; every new library justified
- [ ] Auth flows: rate limits, no account enumeration, token rotation, MFA for staff
- [ ] Realtime: authenticated handshake, server-side rooms, ID-only payloads
- [ ] Audit events for state changes and patient-record access
- [ ] Web: CSP-compatible, no `dangerouslySetInnerHTML`, correct cookie flags. Mobile: secure storage, cleanup on logout
- [ ] Privacy: data minimization, consent, retention, export and deletion still work; data stays in the market's region
- [ ] Notes: role + setting checks, versioning, no hard delete, encrypted body
- [ ] Files: pre-signed upload, magic-byte allowlist, virus scan before visibility, image re-encoding, signed downloads, audit
- [ ] Family: every `patientId` checked against active links; invitations single-use; minors' access expires
- [ ] Notifications: no health data in texts, subjects, previews, push payloads, SMS, `.ics` or links; preferences enforced; device tokens deleted on sign-out; SMS only to verified numbers, codes hashed and rate-limited
- [ ] Public practice page: published fields only, no cookies or third-party resources, staff shown only with their own consent, cache purged on changes
- [ ] Uploads of logos and staff photos: PNG/WebP (no SVG), magic bytes, re-encoding, virus scan; theme colours validated as hex only
