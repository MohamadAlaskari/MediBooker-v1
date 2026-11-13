# 0017. Team roles: a base role and practice management

Status: Accepted — 2026-11-12 (D17, built in M03 part 1), the user's decision

## Context

Until M03 a membership of a practice's team had one of three roles: `STAFF`, `DOCTOR` or `ADMIN`. An owner who is also a doctor could not be both, because the link to a doctor (M04) needs the role `DOCTOR`, and `ADMIN` mixed the running of the practice with access to clinical content. Routes named the roles they admitted, so every new right meant editing lists of roles across controllers.

The user decided on 2026-11-12 (D17, [09](../architecture/09-risks-and-decisions.md#d17-team-roles)): a base role and an add-on "practice management"; only practice management gives or changes roles, the add-on too; a page for the whole team, filtered by doctors and the others.

## Decision

1. **A base role and an add-on.** A membership has the base role `STAFF` (the practice team: reception, medical assistants) or `DOCTOR`, and `manages_practice`. Practice management takes nothing away from the base role and adds the running of the practice: services, the team, settings, patient exports and the audit log (D18). It adds nothing clinical: a manager who is not a doctor reads no clinical content (D13).
2. **Routes ask for a capability, not a role.** `@PracticeScoped('id', { staff })` takes one of three, computed in one table (`common/tenancy/staff-capability.ts`):
   - `team`: every active member;
   - `planning`: the practice team or practice management (opening hours, special days, every doctor's schedule, slot generation); a doctor without it plans only itself;
   - `management`: practice management.
3. **Only practice management changes the team** (W15): base role, the add-on, a doctor's link, deactivating and reactivating, and removing a lost authenticator app. At least one active member keeps practice management: the last one can neither lose it nor be deactivated (`LAST_PRACTICE_MANAGER`). The target and every active manager are locked in one order in the same transaction, so two managers cannot remove each other at the same time. Nobody deactivates or resets their own account (`NOT_ON_YOURSELF`); one account is one doctor (`DOCTOR_ALREADY_LINKED`).
4. **Every change is audited and told.** The practice's audit log names the change (`staff.role.set`, `staff.management.grant|revoke`, `staff.provider.link|unlink`, `staff.deactivate`, `staff.reactivate`, `staff.second-factor.reset`), the platform's the ended sessions and the removed factor. The member gets a security e-mail without a link, at a confirmed address only: E13 when the role changed (not for one's own change) or the access came back, E14 when the access ended, E15 when the authenticator app was removed.
5. **Deactivating ends the access at once.** The membership becomes `DISABLED`, its doctor link goes, the access index follows through the relay, and every session of the account ends. Ending the sessions first takes the account row's lock, as a sign-out does, so a refresh under way leaves no session behind; when the sessions cannot end, the deactivation stands and the answer is the failure. Reactivating ends every session of the account first, so no session from before gets the team's pages back, and then gives the role back; a doctor is linked again by a role change.
6. **The operator sets the first manager.** `staff-role.js <e-mail> [STAFF|DOCTOR|NONE] [MANAGE] [<doctor id>]`; only the e-mail gives the practice team with practice management. Invitations (E09) follow in M03 part 2.
7. **Migration.** Every `ADMIN` becomes `STAFF` with practice management, in one transaction; the enum is replaced, its steps marked `-- contract`.

## Consequences

- A doctor who runs the practice is one account: `DOCTOR` with practice management, which also plans every doctor.
- A new right is a line in the capability table and a capability on its routes, not a list of roles per route.
- The web reads `managesPractice` from the membership answer and only leaves out what the API would refuse; the API decides.
- Removing a lost authenticator app no longer needs the operator: practice management does it after checking it is really the person (RT-96). The operator's command stays for the first manager and for a practice with none left active.
- Support access (ADR 0005 §9.4) becomes an invitation of practice management with a reason, a role and an expiry (M03 part 3).

## Alternatives considered

- **The three roles, with an admin who may also be a doctor:** two exceptions instead of one model, and `ADMIN` would still carry clinical access.
- **Every right per person:** the most flexible, but a small practice would have to understand and maintain a matrix of rights, and every screen and test would multiply.
