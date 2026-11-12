# MediBooker v2 — Feature catalogue and screen inventory

Status: draft v0.4 · 2026-11-01 · Languages: Arabic (default, RTL) and English · Themes: light and dark, plus practice colour themes
Figma: https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker — pages "Patient App (Mobile)", "Clinic Dashboard (Web)", "Patient Portal (Web)", "Email Templates" and "Tablet Layouts"

Every screen exists in four variants: Arabic RTL light, Arabic RTL dark, English LTR light, English LTR dark. Extra frames marked `· Theme <name>` show a practice colour theme. All surfaces are clickable prototypes (section 5.5). Business rules (BR-xx) are defined in the `medibooker-domain` skill; endpoints in `api-contract`; security rules in `health-data-security`. All e-mails, push notifications and SMS with their texts: [notifications.md](notifications.md). Theme decision: [ADR 0002](../adr/0002-practice-themes.md).

Status legend: **v0.1** = first iteration · **v0.2** = records, notes, files, family · **v0.3** = prototype, patient web portal, e-mails, push notifications · **v0.4** = SMS, tablet layouts, doctor photos, public practice page, practice themes · **later** = agreed idea, not designed yet.

## 1. Roles

| Role | Arabic | Uses | Can |
|---|---|---|---|
| Visitor (not signed in) | زائر | Public practice page (web) | See the practice, services, free times, team, opening hours and directions; choose a time (sign-in or sign-up follows) |
| Patient / account holder | المريض / صاحب الحساب | Patient app (iOS, Android), patient web portal | Book and manage appointments for self and managed family members; see shared notes and files |
| Family member (managed) | فرد من العائلة | – (or own account for adults) | Is booked for; adults accept an invitation before anyone else manages them |
| Receptionist | موظف الاستقبال | Clinic dashboard | Calendar, appointments, check-in, patients, administrative files |
| Doctor | الطبيب | Clinic dashboard | Everything a receptionist can + clinical notes, clinical files, full patient record |
| Clinic admin | مدير العيادة | Clinic dashboard | Services, working hours, team, settings, audit log (no clinical content by default) |

## 2. Patient app (mobile; the patient web portal mirrors these features)

### 2.1 Account and access

| ID | Feature | Rules | Screens | Status |
|---|---|---|---|---|
| P-01 | Sign up with e-mail + password, accept privacy policy | BR-09 | 09 Sign up – Account | v0.2 |
| P-02 | Personal details (name, date of birth, phone) | – | 10 Sign up – Your details | v0.2 |
| P-03 | Insurance (type, provider, number; options per market) | BR-10 | 11 Sign up – Insurance | v0.2 |
| P-04 | E-mail verification before the first booking | BR-09 | 12 Verify email | v0.2 |
| P-05 | Sign in | – | 01 Sign in | v0.1 |
| P-06 | Forgot / reset password | – | 13 Forgot password | v0.2 |
| P-07 | Sign out (clears tokens, cache, push token) | – | 22 Profile | v0.2 |
| P-08 | Language Arabic / English, layout switches RTL / LTR | – | 27 Language | v0.2 |
| P-09 | Light and dark mode (follows the system) | – | all | v0.1 |

### 2.2 Booking

| ID | Feature | Rules | Screens | Status |
|---|---|---|---|---|
| P-10 | Choose who the appointment is for (me or a family member) | BR-19 | 14 Book – Who is it for? | v0.2 |
| P-11 | Choose a service (only bookable online, allowed for the insurance) | BR-08 | 03 Book – Service | v0.1 |
| P-12 | Choose day and time (free slots, booking window) | BR-01, BR-03 | 04 Book – Date & time | v0.1 |
| P-13 | Review, add an optional reason for the visit, confirm | BR-02 | 05 Book – Review | v0.1 (+ patient row v0.2) |
| P-14 | Booking confirmation, add to device calendar | BR-13 | 06 Booked | v0.1 |
| P-15 | Error: time just taken by someone else | BR-01 | 15 Review – Time taken | v0.2 |
| P-16 | Choose a doctor: round photo and name per doctor, or "Any doctor" (placeholder icon). Photos only with the doctor's consent, otherwise initials | BR-24 | 04 Book – Date & time, PW4, T2, T8 (staff: W7, W14) | v0.4 |

### 2.3 My appointments

| ID | Feature | Rules | Screens | Status |
|---|---|---|---|---|
| P-20 | Upcoming appointments for me and my family | – | 07 My appointments | v0.1 |
| P-21 | Empty state | – | 07b My appointments – empty | v0.1 |
| P-22 | Past appointments (completed, cancelled, no-show) | – | 18 My appointments – Past | v0.2 |
| P-23 | Appointment details: time, doctor, place, patient, preparation note from the doctor | BR-16 | 16 Appointment details | v0.2 |
| P-24 | Reschedule (atomic) | BR-04, BR-05 | 17 Reschedule | v0.2 |
| P-25 | Cancel with confirmation; after the deadline only by phone | BR-04 | 08 Cancel appointment (dialog) | v0.1 |

### 2.4 Health record (patient view)

| ID | Feature | Rules | Screens | Status |
|---|---|---|---|---|
| P-30 | Health record per person (switch between me and family members) | BR-18, BR-19 | 19 Health record | v0.2 |
| P-31 | Visit details with notes and files the doctor shared | BR-16, BR-17 | 20 Visit details | v0.2 |
| P-32 | View and download a shared document or image | BR-17 | 21 Document viewer | v0.2 |

### 2.5 Family accounts

| ID | Feature | Rules | Screens | Status |
|---|---|---|---|---|
| P-40 | List of family members incl. pending invitations | BR-19 | 24 Family members | v0.2 |
| P-41 | Add a child (guardian declaration) | BR-19 | 25 Add family member | v0.2 |
| P-42 | Invite an adult (they accept in their own account) | BR-19 | 25 Add family member | v0.2 |
| P-43 | Book, reschedule, cancel and see the record of managed members | BR-19 | 14, 07, 19 | v0.2 |
| P-44 | Notifications for managed members go to the managing account(s) | BR-20 | – (push/e-mail) | v0.2 |

### 2.6 Profile and privacy

| ID | Feature | Rules | Screens | Status |
|---|---|---|---|---|
| P-50 | Profile overview | – | 22 Profile | v0.2 |
| P-51 | Edit personal details and insurance | BR-10 | 23 Personal details | v0.2 |
| P-52 | Reminder consent (push / e-mail) | BR-13 | 26 Privacy & data, 29 Notification settings | v0.2 (v0.3: settings screen) |
| P-53 | Export my data, delete my account | BR-14 | 26 Privacy & data | v0.2 |

### 2.7 Notifications

| ID | Feature | Rules | Screens | Status |
|---|---|---|---|---|
| P-54 | After the first booking, explain push notifications before the system permission prompt | BR-20 | 06 Booked → 28 Allow notifications | v0.3 |
| P-55 | Notification settings per message type and channel (push / e-mail / SMS); changes by the clinic and security e-mails cannot be turned off | BR-13, BR-20, BR-21 | 22 Profile → 29 Notification settings; PW12 | v0.3 (v0.4: SMS column) |
| P-56 | Push notifications: booked by the clinic, reminder, moved, cancelled, new in the health record, family invitation accepted. Tapping opens the matching screen after sign-in | BR-13, BR-20 | 30 / 31 (previews) | v0.3 |
| P-57 | E-mails: verify e-mail, reset password, booked, reminder, moved, cancelled, new in health record, family invitation, staff invitation, new sign-in | BR-09, BR-13, BR-20 | E01–E10 | v0.3 |
| P-58 | SMS (if the clinic sends appointment messages by SMS — "SMS only" or "e-mail and SMS"): reminder, booked by the clinic, cancelled by the clinic, moved by the clinic. Only to a verified phone number, otherwise e-mail; one-way sender name (e.g. `AlNoorClinic`) | BR-21 | 29 (SMS column), 32 SMS – Messages (preview); clinic setting in W21 | v0.4 |

Texts contain date, time, clinic and the first name of the person only — never service names, notes or file contents. Full list with Arabic and English texts, triggers, deep links and SMS lengths: [notifications.md](notifications.md).

### 2.8 Patient web portal

| ID | Feature | Rules | Screens | Status |
|---|---|---|---|---|
| P-60 | Patient portal in the browser (desktop) with the app features: home, booking for me or family, my appointments, appointment details and cancel, health record, family, notification settings | as in the app | PW1–PW12 | v0.3 |
| P-61 | Tablet layouts: app on iPad / Android tablets (home, booking, my appointments in two panes) and portal on tablets (compact header with menu) | as in the app | T1–T3, T7–T8 | v0.4 |

### 2.9 Public practice page (no sign-in)

| ID | Feature | Rules | Screens | Status |
|---|---|---|---|---|
| P-70 | Public page per clinic: name, logo or initials, short description per language, "open now" status, address, phone, languages spoken; header with section links, language switch, sign in and book | BR-22 | PW13 (desktop), PW14 (mobile web) | v0.4 |
| P-71 | Services with duration and hints; "Book appointment" leads to the booking page, through signing in (B07, D19) | BR-08, BR-22 | PW13, PW14 | v0.4 |
| P-77 | **Free times after signing in** (D19, B07; without sign-in until then): on the booking page, service, doctor (round photo) or any doctor, week strip (weekend and closed days disabled), morning and afternoon times. The practice page leads to sign-in or sign-up and back; choosing a time leads to the details at the first booking, then to the review with this time | BR-03, BR-09, BR-22 | PW13, PW14 → PW1 | v0.4 |
| P-72 | Team: doctors with round photo, specialty and languages — only people who agreed in their own profile; the reception is shown as a team card without names | BR-24 | PW13, PW14 | v0.4 |
| P-73 | Opening hours of the clinic (not the doctors' working hours) with today highlighted and special days (e.g. closed on 19 Nov for team training) | BR-22 | PW13, PW14 | v0.4 |
| P-74 | Getting here and contact: link to a maps app (no embedded map), bus stop, parking, step-free access, phone, insurance and payment, e-mail with the hint "no medical details by e-mail" | BR-22 | PW13, PW14 | v0.4 |
| P-75 | Arabic and English versions with their own address for search engines; footer with legal notice, privacy, accessibility and "Online booking with MediBooker" | BR-22 | PW13, PW14 | v0.4 |
| P-76 | The page uses the clinic's colour theme and logo (status colours stay the same) | BR-23 | PW13 · Theme Violet, PW14 · Theme Ocean | v0.4 |

## 3. Clinic dashboard (web)

| ID | Feature | Rules | Screens | Status |
|---|---|---|---|---|
| D-01 | Staff sign in | – | W3 Sign in | v0.2 |
| D-02 | Two-factor authentication (TOTP, recovery codes) | – | W4 Two-factor | v0.2 |
| D-03 | Automatic logout after inactivity | – | – | v0.2 |
| D-10 | Today overview: KPIs, today's appointments, live booking toast | BR-12 | W1 Today | v0.1 |
| D-11 | Week calendar per doctor: booked, checked in, available, blocked | – | W2 Calendar | v0.1 |
| D-12 | Appointment list with search and filters (date, doctor, status) | – | W5 Appointments | v0.2 |
| D-13 | Appointment details: check in, complete, no-show, cancel with reason, reschedule | BR-04, BR-07, BR-11 | W6 Appointment details | v0.2 |
| D-14 | Book on behalf of a patient or a family member (phone booking); doctor picker with photos | BR-02, BR-19, BR-24 | W7 Book for patient | v0.2 (v0.4: doctor photos) |
| D-20 | **Clinical notes per appointment** (doctor), internal or shared with the patient, versioned, never deleted | BR-16 | W6, W10 | v0.2 |
| D-21 | **Images and documents per appointment** (upload, virus scan, visibility, download) | BR-17 | W6, W11 | v0.2 |
| D-22 | **Patient record**: overview, appointments, notes, files, family | BR-18 | W9, W10, W11 | v0.2 |
| D-23 | Patient list with search; add a patient (walk-in) | – | W8 Patients | v0.2 |
| D-24 | Family links in the record ("managed by", dependents, pending invitations) | BR-19 | W9 | v0.2 |
| D-30 | Services: list, create, edit (names ar/en, duration, online, insurance types) | BR-08 | W12 Services, W13 Edit service | v0.2 |
| D-31 | Working hours per doctor, exceptions (vacation), generate times | BR-06, BR-07 | W14 Working hours | v0.2 |
| D-32 | Team: list, invite with role, MFA status, disable | – | W15 Team, W16 Invite staff | v0.2 |
| D-33 | Settings (tabs General · Practice page · Appearance · Notifications) — General: clinic, region & language (time zone, digits, week start, weekend), booking rules, clinical data policy; link to reminders and notifications | BR-02–04, BR-15 | W17 Settings | v0.2 (v0.4: tabs) |
| D-38 | Notification settings: channels for appointment messages (e-mail only, SMS only, e-mail and SMS), reminders on/off and timing, SMS sender name, SMS provider status ("not connected yet" → everything goes by e-mail), SMS preview with length, send a test | BR-13, BR-21 | W21 Settings – Notifications | v0.4 |
| D-34 | Audit log (record access, notes, files, status changes, settings) | BR-12, BR-18 | W18 Audit log | v0.2 |
| D-35 | Practice page settings: publish on/off, page address, sections shown, description per language, team on the page with each person's consent status, opening hours and special days (bookable times stay in W14) | BR-22, BR-24 | W20 Settings – Practice page | v0.4 |
| D-36 | Appearance: colour theme from presets (Teal default, Ocean, Indigo, Violet, Graphite) or a custom colour with automatic contrast check; logo upload (PNG / WebP) or initials; light and dark preview. Applies to app, portal, practice page, e-mails and dashboard; status colours and the MediBooker logo never change | BR-23 | W19 Settings – Appearance (example: W19 · Theme Ocean) | v0.4 |
| D-37 | Tablet layouts for the dashboard (landscape): Today, Appointments with detail panel, Patient record | as on desktop | T4–T6 | v0.4 |

## 4. Platform features (no own screen)

| ID | Feature |
|---|---|
| X-01 | REST API with OpenAPI contract and generated client for web and mobile |
| X-02 | Realtime events for the dashboard (IDs only) |
| X-03 | Notifications: push; appointment messages per clinic by e-mail, SMS or both; account and security messages by e-mail; WhatsApp later |
| X-04 | Security: argon2id, rotating refresh tokens, RBAC + ownership + family delegation, rate limits, audit |
| X-05 | Encryption of notes, insurance numbers and files; signed short-lived download URLs; virus scanning |
| X-06 | Data export and deletion per patient; retention jobs |
| X-07 | Market configuration: country, data residency region, time zone, digits, weekend, insurance model |
| X-08 | i18n (Arabic, English; more later) with RTL / LTR |
| X-09 | Practice themes at runtime: brand colour layer (presets or a generated, contrast-checked custom palette) for web, app and e-mails; no hard-coded colours (ADR 0002) |
| X-10 | Public practice page delivery with Next.js (ADR 0003): server-rendered and cached for search engines, free times refreshed every 30–60 s, one URL per language (`hreflang`), structured data (`schema.org/MedicalClinic`), no cookies or third-party trackers |
| X-11 | Responsive layouts: phone, tablet (portrait and landscape) and desktop; web breakpoints in the `design-system` skill |

## 5. Screen inventory

All screens are designed in Figma ([Mediboocker](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker)). Each screen exists four times, in one column: Arabic RTL light, Arabic RTL dark, English LTR light, English LTR dark. The links open the English light frame.

### 5.1 Patient app (390 × 844) — page "Patient App (Mobile)"

| Frame | Content | Main components |
|---|---|---|
| [01 Sign in](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=26-7) | Logo, e-mail, password, forgot password, create account | Text Field, Button |
| [02 Home](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=26-94) | Greeting, next appointment, book button, clinic contact | Appointment Card, Button, List Item, Tab Bar |
| [03 Book – Service](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=26-247) | Steps, service list | Step, Service Card |
| [04 Book – Date & time](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=26-358) | Doctor (round photo + name, or any doctor), month, week strip, morning/afternoon slots, summary | Doctor Option, Calendar Day, Time Slot |
| [05 Book – Review](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=27-307) | Patient, service, date and time, doctor, reason, cancellation hint | List Item, Text Field, Alert |
| [06 Booked](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=27-414) | Success, summary, add to calendar | Appointment Card, Button |
| [07](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=27-504) / [07b](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=27-639) My appointments | Upcoming list / empty state | Segmented Control, Appointment Card, Empty State |
| [08 Cancel appointment](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=27-716) | Dialog over list | Dialog |
| [09 Sign up – Account](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=51-2029) | E-mail, password, consent | Text Field, Checkbox |
| [10 Sign up – Your details](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=51-2125) | Name, date of birth, phone | Step, Text Field |
| [11 Sign up – Insurance](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=51-2218) | Insurance type, provider, number | Radio, Text Field |
| [12 Verify email](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=51-2300) | Inbox hint, open mail app, resend | Button |
| [13 Forgot password](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=51-2358) | E-mail, send link | Text Field, Button |
| [14 Book – Who is it for?](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=52-2267) | Me + family members, add member | Person Card |
| [15 Review – Time taken](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=52-2342) | Error alert, choose another time | Alert |
| [16 Appointment details](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=52-2439) | Date/time, doctor, place, patient, preparation note, actions | Note Card, List Item, Button |
| [17 Reschedule](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=52-2572) | Current appointment, new day/time, confirm | Alert, Calendar Day, Time Slot |
| [18 My appointments – Past](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=52-2697) | Completed, cancelled (family member), no-show | Appointment Card |
| [19 Health record](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=54-2609) | Person tabs, visits timeline, shared documents | Tab, Timeline Item, Attachment Tile |
| [20 Visit details](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=54-2718) | Visit summary, shared notes, files | Note Card, Attachment Tile |
| [21 Document viewer](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=54-2830) | Preview, download | Top App Bar, Button |
| [22 Profile](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=54-2880) | Account header, settings list (incl. Notifications), sign out | List Item |
| [23 Personal details](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=55-2885) | Edit form (e-mail change needs confirmation) | Text Field |
| [24 Family members](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=55-2976) | Members, pending invitation, add member | Person Card, Alert |
| [25 Add family member](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=55-3048) | Relationship, name, date of birth, guardian declaration | Radio, Text Field, Checkbox |
| [26 Privacy & data](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=55-3131) | Export, consents, reminders, delete account | List Item, Switch, Button |
| [27 Language](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=55-3199) | Arabic / English | Radio |
| [28 Allow notifications](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=98-6965) | Explanation before the system prompt, allow / not now | Button |
| [29 Notification settings](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=98-7024) | Push / e-mail / SMS per message type, always-on items, which phone number gets SMS | Switch |
| [30 Push – Lock screen (iOS)](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=98-7101) | Preview: booked by the clinic, reminder, new in record | Push Notification |
| [31 Push – Notification shade (Android)](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=98-7148) | Preview: moved, family invitation accepted, cancelled | Push Notification |
| [32 SMS – Messages](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=128-7601) | Preview in the phone's messages app: reminder, booked by the clinic, cancelled, moved; "you can't reply" | SMS Bubble |

### 5.2 Clinic dashboard (1440 × 1024) — page "Clinic Dashboard (Web)"

| Frame | Content | Main components |
|---|---|---|
| [W1 Today](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=42-7) | KPIs, today's appointments, live toast | Sidebar, Stat Card, Appointment Row, Toast |
| [W2 Calendar](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=43-580) | Week grid per doctor | Calendar Event, Segmented Control |
| [W3 Sign in](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=63-1309) | Staff login, language switch, 2FA hint | Text Field, Button |
| [W4 Two-factor](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=63-1379) | 6-digit code, recovery code | Button (code boxes stay LTR in Arabic) |
| [W5 Appointments](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=64-1364) | Filters, rows grouped by day, pagination | Text Field, Appointment Row, Icon Button |
| [W6 Appointment details](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=64-1817) | Drawer: patient, status actions, reason, clinical notes + composer, files + upload | Note Card, Text Area, Switch, Attachment Tile, Upload Dropzone |
| [W7 Book for patient](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=65-2044) | Modal: guardian search, family member, service, doctor (photo + name), day, time | Person Card, Doctor Option, Text Field, Calendar Day, Time Slot |
| [W8 Patients](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=65-2251) | Search, filters, patient table with family column | Patient Row |
| [W9 Patient record – Overview](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=68-2634) | Header, tabs, upcoming, visit timeline, latest note, files, family | Tab, List Item, Timeline Item, Note Card, Attachment Tile, Person Card |
| [W10 Patient record – Notes](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=69-2879) | Notes per appointment, composer, visibility info | Note Card, Text Area, Switch, Alert |
| [W11 Patient record – Files](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=69-3130) | Files per appointment, upload with visibility | Attachment Tile, Upload Dropzone, Switch |
| [W12 Services](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=71-3153) | Service table, online booking switch | Switch, Badge, Alert |
| [W13 Edit service](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=71-3357) | Modal: texts per language, duration, doctors, online, referral | Tab, Text Field, Text Area, Checkbox, Switch |
| [W14 Working hours](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=72-3358) | Doctor picker (photo + name), weekly schedule per doctor, exceptions, generate booking times | Doctor Option, Switch, Text Field, List Item, Alert |
| [W15 Team](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=72-3650) | Staff table: role, 2FA, last active, status | Avatar, Badge, Alert |
| [W16 Invite staff](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=72-3901) | Modal: name, e-mail, role with permissions | Text Field, Radio, Alert |
| [W17 Settings](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=73-3783) | Tabs General · Practice page · Appearance · Notifications; clinic, region & language, booking rules (link to reminders and notifications), clinical data | Tab, Text Field, Radio, Switch, Button |
| [W18 Audit log](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=73-4054) | Filters, event table, export | Avatar, Badge, Text Field |
| [W19 Settings – Appearance](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=150-12721) | Theme presets, custom colour with contrast result, status colours note, logo or initials, light/dark preview | Theme Swatch, Practice Mark, Text Field, Badge, Alert, Button, Time Slot, Switch |
| [W20 Settings – Practice page](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=150-13240) | Publish switch, page address, sections shown, opening hours and special days, description per language, team with consent status | Switch, Text Field, Checkbox, Text Area, Badge, Avatar |
| [W21 Settings – Notifications](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=162-21806) | Channels for appointment messages (e-mail only / SMS only / e-mail and SMS), reminders, SMS sender name and provider status, SMS preview | Radio, Alert, Switch, Text Field, SMS Bubble |
| [W19 · Theme Ocean](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=152-14059) | Example: the whole dashboard after choosing "Ocean" | – |

### 5.3 Patient web portal (1440 × 1024) — page "Patient Portal (Web)"

| Frame | Content | Main components |
|---|---|---|
| [PW1 Sign in](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=101-4) | Brand panel, sign in, create account, language switch | Text Field, Button |
| [PW2 Home](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=101-102) | Next appointment, upcoming (family), family, new in record, clinic contact | Portal Header, List Item, Person Card, Attachment Tile |
| [PW3 Book – Person & service](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=108-316) | Who is it for, service, summary | Step, Person Card, Service Card |
| [PW4 Book – Date & time](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=108-493) | Month calendar (week starts Sunday, weekend and closed days), doctor (photo + name), slots | Doctor Option, Calendar Day, Time Slot |
| [PW5 Book – Review](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=108-772) | Review, reason, preparation, confirm | List Item, Text Area, Alert |
| [PW6 Booked](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=108-927) | Success, summary, add to calendar | Button |
| [PW7 My appointments](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=110-623) | Upcoming / past, person filter, table with actions | Tab, Avatar, Badge |
| [PW8 Appointment details](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=110-910) | Details, preparation note, reason, manage | List Item, Note Card, Button |
| [PW9 Cancel appointment](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=110-1079) | Confirmation modal | Button |
| [PW10 Health record](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=111-947) | Person tabs, visits, visit details with shared note and files | Tab, Timeline Item, Note Card, Attachment Tile |
| [PW11 Family](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=111-1113) | Members, add a child (guardian declaration) | Person Card, Radio, Checkbox |
| [PW12 Settings – Notifications](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=111-1275) | Settings navigation, push / e-mail / SMS per message type | Sidebar Item, Switch |
| [PW13 Practice page (public)](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=147-4916) | Desktop, no sign-in: header with section links, hero with open-now status and opening hours, free times (service, doctor, week, times), services, team, find us, contact, footer | Practice Mark, Badge, Button, Text Field, Doctor Option, Calendar Day, Time Slot, Service Card, Team Card, List Item, Alert, Logo |
| [PW14 Practice page (public, mobile)](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=148-5083) | The same page for phones (390 px), one column, free times right after the hero | as PW13, Icon Button |
| [PW13 · Theme Violet](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=153-6497) / [PW14 · AR · Dark · Theme Ocean](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=153-6609) | Examples of the practice page in other clinic themes | – |

PW13 and PW14 are longer than one screen, so they sit in their own band below the portal rows (columns: Arabic, Arabic dark, English, English dark; mobile next to desktop). Portal sign-up uses the same steps as the app (09–12); a separate desktop layout is not designed.

### 5.4 E-mail templates (600 px) — page "Email Templates"

Each template shows subject and preview text above the e-mail. Texts and triggers: [notifications.md](notifications.md).

| Frame | Sent when | Button |
|---|---|---|
| [E01 Verify e-mail](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=114-12) | Sign-up | Confirm e-mail address |
| [E02 Reset password](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=114-43) | Password reset requested | Choose a new password |
| [E03 Appointment booked](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=114-71) | Appointment booked (app, portal or clinic) | View appointment |
| [E04 Appointment reminder](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=114-113) | 24 h before (with consent) | View appointment |
| [E05 Appointment moved](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=114-155) | Clinic reschedules | View appointment |
| [E06 Appointment cancelled](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=114-193) | Clinic cancels | Book a new time |
| [E07 New in health record](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=114-231) | A note or file is shared | Open health record |
| [E08 Family invitation](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=114-259) | An adult is invited to a family account | Review invitation |
| [E09 Staff invitation](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=114-290) | Admin invites a staff member | Set up your account |
| [E10 New sign-in](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=114-327) | Sign-in from a new device | This was not me – secure my account |

### 5.5 Clickable prototype

Open a page in Figma, press **Present** and pick a flow (Figma prototypes work per page).

| Page | Flows | Connections | What is clickable |
|---|---|---|---|
| Patient App (Mobile) | App · العربية / English, light and dark; Push · العربية / English; SMS · العربية / English | 348 | Sign in and sign up, booking flow, my appointments (cancel, reschedule, past), details, health record and documents, profile, family, notification settings, tab bar, back buttons; language "Apply" switches between the Arabic and English rows; tapping a push preview opens the app screen |
| Clinic Dashboard (Web) | Dashboard · العربية / English, light and dark | 783 | Sign in → two-factor → Today; sidebar; appointments → drawer → patient record (tabs); book for patient; services → edit; calendar → working hours; team → invite; settings tabs General ↔ Practice page ↔ Appearance ↔ Notifications, practice page → working hours, general → notifications, settings → audit log; language switch |
| Patient Portal (Web) | Portal · …; Practice page · …; Practice page (mobile) · … (each Arabic / English, light and dark) | 536 | Header navigation, language switch (jumps to the other row), booking flow, appointments → details → cancel, health record, family, settings; practice page: section links scroll to Services / Team / Opening hours, "Book appointment" and service cards scroll to the free times, a free time and "Sign in" open PW1 |
| Tablet Layouts | Tablet app · …, Tablet dashboard · …, Tablet portal · … (each AR, AR dark, EN, EN dark) | 84 | App: book, tab bar, back; dashboard: sidebar, all appointments, details, open record, back to patients; portal: book, back; language switch |

Not designed yet: WhatsApp texts, a separate desktop sign-up, sign-in and booking in the phone browser (a free time on PW14 continues there), a tablet patient list, the staff profile screen where a person gives photo / public-page consent (W20 shows the status), a full editor for opening hours and special days (W20 shows the summary).

### 5.6 Tablet layouts — page "Tablet Layouts"

App and portal in portrait (834 × 1194, iPad 11"), dashboard in landscape (1194 × 834). Same four rows as the other pages.

| Frame | Content | Layout |
|---|---|---|
| [T1 App – Home (iPad)](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=133-12) | Greeting, next appointment, upcoming (family), family, clinic, new in record | Two columns, tab bar stays at the bottom |
| [T2 App – Book date & time (iPad)](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=133-244) | Steps, doctor picker with photos, month calendar and times side by side, summary bar | Calendar + time panel |
| [T3 App – My appointments (iPad)](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=133-488) | Upcoming / past list with the selected appointment's details | List + detail pane |
| [T4 Dashboard – Today (tablet)](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=134-398) | KPIs, today's table with check-in | Sidebar + content |
| [T5 Dashboard – Appointments (tablet)](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=134-654) | Week list grouped by day, detail panel with actions and clinical notes | List + detail panel instead of the desktop drawer |
| [T6 Dashboard – Patient record (tablet)](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=134-880) | Header, tabs, visits, latest note, family | Two columns |
| [T7 Portal – Home (tablet)](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=135-786) | As PW2 | Portal Header Size=Compact (menu), stacked cards |
| [T8 Portal – Book date & time (tablet)](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=135-968) | As PW4 with doctor photos | Calendar + time panel, sticky summary |

## 6. Open decisions

1. Which clinical notes may be shared with patients — every note (doctor decides per note, current design) or only special note types (e.g. "instructions")?
2. Can receptionists read clinical notes? Current design: no, configurable per clinic.
3. Can patients upload files themselves (e.g. old findings)? Not designed yet.
4. Age of majority and guardian rules per market (default 18).
5. Medical imaging (DICOM, X-ray viewers) — out of scope; only images and PDFs.
6. Retention period for notes and files per market (medical documentation duties).
7. ~~Web framework~~ — **decided 2026-11-01: Next.js** (ADR 0003).
8. Page address: path (`medibooker.example/al-noor`, current design), subdomain per clinic, or the clinic's own domain (needs TLS certificates per domain). **Still open.**
9. ~~Free times on the public page~~ — **decided 2026-11-01: free times are public; changed on 2026-11-12 (D19): only after signing in, on the booking page (B07)**, until then (PW13/PW14 "Free times", BR-22; `GET /availability` and `GET /slots` are public).
10. ~~Practice theme in the dashboard~~ — **decided 2026-11-01: yes**, on all surfaces of the clinic; the MediBooker logo stays teal (ADR 0002 accepted).
11. ~~Custom colours~~ — **decided 2026-11-01: any colour, automatically adjusted for contrast** (ADR 0002).
12. Legal notice and privacy policy per market: required content differs per country; the clinic provides it.
13. SMS: **decided 2026-11-01: each clinic chooses e-mail only, SMS only, or both** (W21). Still open: the SMS provider, registration of sender names per country, who pays (Arabic SMS need two segments, see notifications.md).
14. Reception staff on the public page by name (if they agree) or only as "Reception team" (current design).
15. ~~Clinics with "SMS only"~~ — **decided 2026-11-01 (ADR 0004): every account needs an e-mail address in v1, also in SMS-only clinics.** Sign-in with phone number and SMS code follows once an SMS provider is chosen.
