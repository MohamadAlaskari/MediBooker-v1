# MediBooker v2 — Notifications (e-mail, push and SMS)

Status: draft v0.4 · 2026-11-01 · Languages: Arabic (default, RTL) and English
Figma: page "Email Templates" (E01–E10; E11 and E12 use the layout of E10; E13–E15 the same layout without a button) and page "Patient App (Mobile)" (28 Allow notifications, 29 Notification settings, 30/31 push previews, 32 SMS – Messages); portal settings PW12; clinic channel settings in W21 Settings – Notifications.
Rules: BR-13, BR-20, BR-21 in the `medibooker-domain` skill. Decision record: [ADR 0001](../adr/0001-notification-channels-and-content.md).

## 1. Principles

1. **Channels:** push in the patient app (iOS, Android) for everyone who allows it. For appointment messages (reminders, changes by the clinic) each clinic chooses in W21: **e-mail only, SMS only, or e-mail and SMS**. SMS go only to a verified phone number. Account and security messages always go by e-mail. WhatsApp is not planned yet.
2. **No health data in messages.** Texts, subjects, previews, push titles, calendar files and links contain only date, time, clinic and the first name of the person. Never the service, the doctor, notes, file names, file contents or a reason. Details are shown in the app or portal after sign-in.
3. **Recipients:** the patient's own account and every account that manages the patient (BR-20). Staff only receive staff e-mails (E09).
4. **Language and time:** the recipient's language (`ar` or `en`, fallback: the clinic's default language); dates and times in the clinic's time zone with the weekday ("Wednesday, 4 November 2026 · 09:30" / "الأربعاء، 4 نوفمبر 2026 · 09:30").
5. **Links:** buttons open the app or portal screen after sign-in. Links carry an opaque ID only. Verify, reset and invitation links carry single-use tokens that are stored hashed (30 minutes for verify and reset, 7 days for invitations).
6. **No tracking:** no tracking pixels, no click tracking. Every e-mail has a plain-text version.
7. **Calendar file (.ics):** title "Appointment at Al Noor Medical Center", time and address only.
8. **Bidirectional text:** phone numbers, e-mail addresses and IDs inside Arabic text are isolated as left-to-right (`<bdi dir="ltr">` in e-mail HTML, U+2066 … U+2069 in push texts). Latin tokens go at the end of Arabic strings.

## 2. Preferences (BR-21)

The patient sees only the clinic's channels: e-mail only → push + e-mail; SMS only → push + SMS; both → push + e-mail + SMS (setting in W21).

| Message type | Push | E-mail | SMS | Can be turned off |
|---|---|---|---|---|
| Appointment reminders (24 h before) | on after consent | on after consent | on after consent | yes, all |
| Changes by the clinic (booked by the clinic, moved, cancelled) | on | always (clinics with e-mail) | always (SMS-only clinics) · optional (both) | push; SMS only where e-mail is also used |
| New in the health record | on | off | – | yes, both |
| Family (invitation accepted, booked by another manager) | on | on | – | yes, both |
| Security and account (verify, reset, invitations, new sign-in) | – | always | – (only the phone verification code S05) | no |

Fallback: a patient without a verified phone number, and every patient while the clinic has no connected SMS provider, gets the SMS messages by e-mail instead — so changes by the clinic always reach the patient.

Screens: 29 Notification settings (app), PW12 Settings – Notifications (portal); both say which phone number receives SMS. The system push permission is requested after the first booking: screen 28 explains it first, then the operating system asks.

## 3. E-mail templates

Width 600 px. Header: clinic logo and name. Footer: clinic address and phone, why the person gets the e-mail, links to notification settings and privacy policy (account e-mails only), "Sent with MediBooker".

| ID | Sent when | To | Subject (English) | Subject (Arabic) | Button → opens | Type |
|---|---|---|---|---|---|---|
| E01 | Sign-up | New user | Confirm your e-mail address | أكّد بريدك الإلكتروني | Confirm e-mail address → verification | Account |
| E02 | Password reset requested | User | Reset your password | إعادة تعيين كلمة المرور | Choose a new password → reset form | Account |
| E03 | Appointment booked (app, portal or clinic) | Patient + managers | Your appointment on Wed, 4 Nov is booked | تم حجز موعدك يوم الأربعاء 4 نوفمبر | View appointment → appointment details | Clinic change* |
| E04 | `reminderHoursBefore` before the start | Patient + managers (with consent) | Reminder: appointment tomorrow at 09:30 | تذكير: موعدك غدًا الساعة 09:30 | View appointment → details | Reminder |
| E05 | Clinic reschedules | Patient + managers | Your appointment was moved | تم تغيير موعدك | View appointment → details | Clinic change |
| E06 | Clinic cancels | Patient + managers | An appointment was cancelled | تم إلغاء موعد | Book a new time → booking | Clinic change |
| E07 | A note or file is shared (`record.shared_item_added`) | Patient + managers | New in your health record | جديد في ملفك الطبي | Open health record → record | Record |
| E08 | An adult is invited to a family account | Invited person | Sara Ahmed invited you to Al Noor Medical Center | دعتك سارة أحمد إلى مركز النور الطبي | Review invitation → accept screen (after sign-in) | Account |
| E09 | Practice management invites a staff member | New staff member | Join the Al Noor Medical Center team | انضم إلى فريق مركز النور الطبي | Set up your account → password + 2FA setup | Account |
| E10 | Sign-in from a browser the account does not know, or from the app (not the account's first sign-in) | User | New sign-in to your account | تسجيل دخول جديد إلى حسابك | This was not me – secure my account → sign out everywhere + reset | Security |
| E11 | A new password was chosen (BR-21) | User | Your password was changed | تم تغيير كلمة المرور | This was not me – secure my account → sign out everywhere + reset | Security |
| E12 | An authenticator app was set up (BR-21) | User | An authenticator app was set up for your account | تم إعداد تطبيق المصادقة لحسابك | This was not me – secure my account → sign out everywhere + reset; the practice removes the app | Security |
| E13 | Practice management changed the member's base role, practice management or doctor link, or gave its access back (D17); not when the change is one's own | Team member | Your place in the practice team has changed | تغيّر مكانك في فريق العيادة | No button: the text says to sign in and to contact the practice if unexpected | Security |
| E14 | Practice management deactivated the member; every sign-in of the account ended (D17) | Team member | Your access to the practice team's pages has ended | انتهى وصولك إلى صفحات فريق العيادة | No button: contact the practice if unexpected | Security |
| E15 | Practice management removed a lost authenticator app and the recovery codes; every sign-in ended (D17, RT-96) | Team member | The authenticator app was removed from your account | تمت إزالة تطبيق المصادقة من حسابك | No button: a new app at the next sign-in; contact the practice at once if unexpected | Security |

\* The booking confirmation is a service message: always sent by e-mail.

Preview texts and the full body texts in both languages are in Figma, above each e-mail.

## 4. Push notifications

App name "MediBooker". Tapping opens the screen after sign-in (Face ID / fingerprint if enabled). Payload: `{ type, appointmentId? | patientId? }` plus the localized title and body — nothing else.

| ID | Sent when | Title (English) | Body (English) | Title (Arabic) | Body (Arabic) | Opens |
|---|---|---|---|---|---|---|
| N01 | The clinic (or another manager) books for you or a family member | Appointment booked for {firstName} | {weekday, date} at {time} · {clinic}. Booked by the clinic. | تم حجز موعد لـ{firstName} | {weekday, date} الساعة {time} · {clinic}. حجزته العيادة. | 16 Appointment details |
| N02 | Reminder, `reminderHoursBefore` before the start | Reminder: tomorrow at {time} | {clinic} · Your clinic left instructions. Tap to read them.** | تذكير: غدًا الساعة {time} | {clinic} · تركت لك العيادة تعليمات. اضغط لقراءتها. | 16 Appointment details |
| N03 | Clinic reschedules | Appointment moved | Your appointment on {old date} is now on {new date} at {time} · {clinic} | تم تغيير موعدك | موعدك يوم {old date} أصبح يوم {new date} الساعة {time} · {clinic} | 16 Appointment details |
| N04 | Clinic cancels | Appointment cancelled by the clinic | {firstName} · {weekday, date} at {time}. Tap to book a new time. | ألغت العيادة موعدًا | {firstName} · {weekday, date} الساعة {time}. اضغط لحجز وقت جديد. | 07 My appointments |
| N05 | A note or file is shared | New in your health record | Your clinic shared a document. Tap to open it. | جديد في ملفك الطبي | شاركت عيادتك مستندًا. اضغط لفتحه. | 19 Health record |
| N06 | An invited adult accepts | {firstName} accepted your invitation | You can now book and manage appointments for {firstName}. | قبل {firstName} دعوتك | يمكنك الآن حجز مواعيد {firstName} وإدارتها. | 24 Family members |

\*\* Only when the doctor left a shared preparation note; otherwise the body is "{clinic} · Tap to see the details."

No push is sent when the user books in the app themselves; the app shows the confirmation and E03 goes out by e-mail.

## 5. SMS (per clinic: SMS only, or e-mail and SMS)

The clinic chooses its channels in [W21 Settings – Notifications](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=162-21806): e-mail only, SMS only, or e-mail and SMS; plus the sender name and the reminder timing. W21 also shows the SMS provider status — while no provider is connected, everything goes by e-mail. Patients choose per message type in 29 / PW12. Preview: app screen [32 SMS – Messages](https://www.figma.com/design/8Ww6QyOO2Ni9kSfN6E5hNK/Mediboocker?node-id=128-7601).

Rules:

- Only for reminders (`REMINDER`) and changes by the clinic (`CLINIC_CHANGE`). Never for record updates, family messages or account e-mails. The only other SMS is the verification code for the phone number (S05).
- Only to a phone number the user has verified (`phoneVerifiedAt`). A changed number must be verified again before SMS go out.
- Same content rule as e-mail and push: date, time, clinic, first name of the person, the clinic's phone number. No service, doctor, note or file. **No links** (links in SMS look like phishing and appear in lock-screen previews); the text names the app instead.
- Sender: an alphanumeric sender name per clinic (up to 11 Latin characters, e.g. `AlNoorClinic`), registered per country where required. One-way: replies are not possible, the preview shows "You can't reply to this sender".
- Encoding: English texts use only GSM-7 characters (straight apostrophe `'`, no typographic quotes or dashes), so up to 160 characters fit in one segment. Arabic needs UCS-2: 70 characters for one segment, 67 per part when longer. All Arabic texts below need two segments; keep them at 134 characters or less.
- Phone numbers in Arabic texts are isolated as left-to-right (U+2066 … U+2069 in the ICU message; the Figma mock uses U+200E).
- Quiet hours as for push. The provider's delivery receipts update `Notification.status`; at most 3 retries; no fallback to another channel (changes by the clinic always go out by e-mail anyway).
- Opt-out in the app and portal settings. Where a market requires a reply keyword (e.g. STOP), a two-way number is needed instead of a sender name — decide per market.

| ID | Sent when | Text (English) | Text (Arabic) | Length of the Figma example (en / ar) |
|---|---|---|---|---|
| S01 | Reminder, `reminderHoursBefore` before the start (with SMS consent) | Reminder from {clinic}: your appointment is tomorrow, {Wed 4 Nov} at {09:30}. Questions? {clinicPhone} | تذكير من {clinic}: موعدك غدًا {الأربعاء 4 نوفمبر} الساعة {09:30}. للاستفسار: {clinicPhone} | 111 GSM-7 = 1 segment / 94 UCS-2 = 2 segments |
| S02 | The clinic (or another manager) books for you or a family member | {clinic}: Appointment for {firstName} booked on {Thu 5 Nov} at {09:00}. Details in the MediBooker app. | {clinic}: تم حجز موعد لـ{firstName} يوم {الخميس 5 نوفمبر} الساعة {09:00}. التفاصيل في تطبيق MediBooker. | 105 = 1 / 98 = 2 |
| S03 | Clinic cancels | {clinic}: {firstName}'s appointment on {Tue 17 Nov} at {10:00} was cancelled by the clinic. Please book a new time in the app. | {clinic}: ألغت العيادة موعد {firstName} يوم {الثلاثاء 17 نوفمبر} الساعة {10:00}. يرجى حجز وقت جديد في التطبيق. | 129 = 1 / 107 = 2 |
| S04 | Clinic reschedules | {clinic}: Your appointment on {Thu 12 Nov} was moved to {Sun 15 Nov} at {08:30}. Another time? Use the MediBooker app. | {clinic}: تم تغيير موعدك من {الخميس 12 نوفمبر} إلى {الأحد 15 نوفمبر} الساعة {08:30}. لاختيار وقت آخر استخدم تطبيق MediBooker. | 126 = 1 / 127 = 2 |
| S05 | The user adds or changes the phone number (not designed in Figma) | {clinic}: your code is {123456}. It is valid for 10 minutes. Never share it. | {clinic}: رمزك {123456}، صالح لمدة 10 دقائق. لا تشاركه مع أحد. | 88 = 1 / 68 = 1 (keep the Arabic code SMS at 70 or less) |

For the user's own appointment the texts say "your appointment" / "موعدك"; for a managed person "{firstName}'s appointment" / "موعد {firstName}". Lengths count every character, including the U+200E mark; longer clinic names push English texts towards 160 characters, so the template tests check the maximum length with the longest clinic name.

## 6. Notes for the implementation

- Domain events → notification service → outbox (`Notification` with `dedupeKey`, so each event is sent once per recipient and channel) → one worker per channel (e-mail, push, SMS), with retries and backoff. Logs contain IDs and status only — never phone numbers or texts.
- SMS: the channel choice and the sender name come from `PracticeSettings` (`appointmentChannels` = `EMAIL` | `SMS` | `EMAIL_AND_SMS`, `smsSenderId`); a channel resolver picks e-mail when SMS is not possible (no verified number, no connected provider); phone verification uses a one-time code (S05) that is stored hashed and expires after 10 minutes, with rate limits per number and per account.
- Templates are rendered at send time from the same ICU message files as the apps (`ar`, `en`); e-mails use `dir="rtl"` and `lang="ar"` for Arabic. Font stack: "Noto Sans Arabic", Tahoma, Arial for Arabic; Inter, Arial, sans-serif for English.
- Push tokens (`DeviceToken`) are registered after the permission on screen 28, refreshed on app start and deleted on sign-out and after 60 days without use.
- Endpoints: `GET`/`PATCH /me/notification-preferences`, `POST /me/devices`, `DELETE /me/devices/{id}`, `POST /me/phone/verification`, `POST /me/phone/verification/confirm` (see `api-contract`).
- Tests: one snapshot per template and language; a check that template variables never include service, doctor, note or file fields; for SMS a check of encoding (GSM-7 for English) and maximum length (two segments for Arabic).

## 7. Open decisions

1. Providers: e-mail (for example Postmark or Amazon SES in the hosting region), push (Expo push service or FCM/APNs directly) and SMS (not chosen yet; an international or a local provider per market) — depends on data residency per market. The code talks to SMS through an adapter interface so the provider can be added later without changing the rules.
2. WhatsApp for markets where it is the main channel (needs approved message templates and a business account per clinic).
3. Quiet hours (proposal: no push between 21:00 and 08:00 except same-day changes) and a second reminder (for example 2 hours before).
4. Sender domain: one per clinic (white label) or one MediBooker domain; SPF, DKIM and DMARC either way.
5. Doctor name in notifications: not shown now (a specialty can reveal a condition).
6. Clinics with "SMS only": patients still need an e-mail address for the account (verification, reset, security). Alternative: sign-in with phone number and SMS code — decide before building auth.
