---
name: feature-delivery
description: End-to-end workflow for shipping a MediBooker v2 feature, from requirement to merged, tested and reviewed code across API, web and mobile, coordinating the project subagents (architect, ui-designer, backend-engineer, web-engineer, mobile-engineer, qa-engineer, security-reviewer, devops-engineer). Use when starting any new feature, user story or change request for MediBooker, and to check the Definition of Done.
---

# Feature delivery workflow

Every feature passes the same gates, in this order. Skip a gate only when it does not apply (for example: no UI change, so no design gate) and say so explicitly.

## 0. Frame the request (main agent)

- Write user stories per role: `As a <patient | receptionist | doctor | practice management> I want … so that …`.
- Write acceptance criteria as Given/When/Then, including failure cases: slot taken meanwhile, past date, deadline passed, DST switch, offline on mobile, missing permissions.
- Check `medibooker-domain` for existing business rules (BR-xx). Flag conflicts with the request.
- Classify the data involved: none, personal, or health (DSGVO Art. 9). Health data makes the security review mandatory.
- If the request touches an **Open** item in CLAUDE.md (tech stack), stop and ask for the decision first.

## 1. Architecture: `architect`

Output: a short design note with affected modules, Prisma schema diff, endpoint list (OpenAPI sketch), events, permission changes (role + ownership), migration or backfill, and open questions. Hard-to-reverse choices get an ADR.

## 2. Design: `ui-designer` (only if the UI changes)

Screens and flows in Figma, built from design-system components, with all states: default, loading, empty, error, success, disabled. Mobile frames 390×844, web 1440 wide. Arabic (RTL, default) and English (LTR) versions. Output: Figma links per screen.

## 3. Contract: `backend-engineer`, reviewed by `architect`

Follow `api-contract`. The contract (DTOs, error codes, events) is merged before web and mobile start, and the client is regenerated.

## 4. Implementation

- `backend-engineer` → `nestjs-feature`
- `web-engineer` → `react-web-feature`
- `mobile-engineer` → `react-native-screen`

Web and mobile can run in parallel once the contract is merged; they depend only on the generated client.

## 5. Tests: `qa-engineer`

Unit and integration tests for the business rules, e2e tests for the happy path and the most likely failure, a concurrency test for anything that books or reserves, accessibility checks for UI.

## 6. Security and privacy review: `security-reviewer`

Mandatory when the change touches auth, permissions, personal or health data, logging, realtime, files, third-party services, infrastructure or dependencies. A BLOCK verdict stops the merge until fixed.

## 7. Release: `devops-engineer` (when infrastructure, CI or app builds change)

## Definition of Done

- [ ] Acceptance criteria demonstrably met (tests, or a recorded manual check with steps)
- [ ] Lint, typecheck and all tests green, locally and in CI
- [ ] Every new endpoint tested for: no token (401), wrong role (403), another user's resource (404), own resource (200)
- [ ] No personal or health data in logs, errors, URLs, analytics, push texts or realtime payloads
- [ ] All UI strings in i18n files (`ar`, `en`); every screen checked in RTL and LTR; dates, times and numbers formatted for the locale in the practice time zone
- [ ] Accessibility checked: labels, focus, contrast, screen reader, large text
- [ ] UI matches the Figma frames; tokens only, no hard-coded colours or sizes
- [ ] Database migration reviewed; seed data updated
- [ ] Docs and ADRs updated
- [ ] Security review passed where required

## Handoff format

Every agent ends its work with this block, so the next one can continue without guessing:

```
## Result
What changed: files, endpoints, Figma nodes, decisions.

## Verification
Commands run and their results, test names, screenshots.

## Open points
Questions, risks, follow-ups. Write "none" if there are none.
```
