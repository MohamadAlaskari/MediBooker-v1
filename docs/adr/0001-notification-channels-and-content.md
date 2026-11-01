# 0001. Notification channels and content
Status: Accepted (channels, incl. optional SMS) / Proposed (providers) — 2026-11-01

History: 2026-11-01 accepted with e-mail and push · 2026-11-01 SMS added as an optional channel per clinic at the client's request · 2026-11-01 each clinic chooses the channels for appointment messages: e-mail only, SMS only, or both (client); SMS provider still open.

## Context

Patients need confirmations, reminders and messages about changes; staff need invitations. Appointment data is health data: a service name, a doctor's specialty or a note can reveal a condition, and push texts appear on lock screens. The client asked for e-mail templates and push notifications, and later the same day for SMS texts (2026-11-01). The target market is not fixed, so providers must allow data residency per market.

## Decision

1. Channels: push in the patient app for everyone who allows it. For appointment messages (reminders and changes by the clinic) each clinic chooses `appointmentChannels`: e-mail only, SMS only, or e-mail and SMS. SMS go only to a verified phone number, under the clinic's sender name, never with links; patients without a verified number, and every patient while no SMS provider is connected, get e-mails instead. Account and security messages always go by e-mail. WhatsApp is not part of v1.
2. Content: messages contain date, time, clinic and the person's first name only — no service, doctor, note, file name or file content (BR-13, BR-20). Details are shown after sign-in.
3. Preferences per type and channel (BR-21): reminders need consent; changes by the clinic always reach the patient on at least one of the clinic's channels (e-mail, or SMS with e-mail as fallback); security and account e-mails cannot be turned off.
4. Delivery through an outbox with a deduplication key; templates rendered at send time in the recipient's language.
5. The full list of messages and texts is kept in `docs/product/notifications.md`; designs are in Figma ("Email Templates", screens 28–32, PW12, clinic channel settings in W21).

## Consequences

Positive: lock screens and inboxes reveal no health data; one place for all texts in Arabic and English; users control optional messages; clinics in markets where SMS matters can reach patients without the app.
Negative: messages are less informative ("Your clinic left instructions" instead of the instruction); patients must open the app for details. SMS cost money per segment — Arabic SMS use UCS-2 and need two segments each — and add another processor that sees phone numbers and appointment times.
Follow-ups: choose e-mail, push and SMS providers per market (data processing agreements, region); register sender names per country; phone verification flow; decide quiet hours and a second reminder; set up SPF, DKIM and DMARC for the sender domain.

## Alternatives considered

- Full details in e-mails (service, doctor, preparation text): more convenient, but exposes health data in inboxes and on lock screens.
- SMS for every message type: simpler to explain, but higher cost and more data at the SMS processor; limited to reminders and changes by the clinic.
- SMS with links to the appointment: convenient, but trains patients to tap links in SMS (phishing) and puts IDs into lock-screen previews.
- Push without per-type settings: simpler, but no way to honour consent for reminders.
