# 0016. One installation per practice

Status: Accepted — 2026-11-10 (I01), the user's decision

## Context

The user sells MediBooker to single practices, in different countries. For each practice it is its own system, for its management and its marketing, under its own registered domain, and a patient learns nothing of other practices. The user decided on 2026-11-10, in two rounds of questions:

- patient accounts are separate per practice, and stay in the practice's country;
- a practice runs only under its own registered domain, not under a subdomain of ours;
- patients see the practice's name, logo, colours and e-mails, and a small "powered by MediBooker";
- each practice gets **its own installation**: its own copy of MediBooker on its own server in its country, rather than one platform per region that serves many practices under their domains. The platform would need host routing, accounts moved into the practice databases and certificates for many domains, about two to three days of rework; the installation needs little, and updates are rolled out per installation.

ADR 0005 built one platform for many practices: a platform database with the accounts and the registry, a database per practice, and features across practices (my appointments across practices, the list of all practices).

## Decision

1. **An installation serves one practice.** It has its own server in the practice's country, its own domain, its own platform and practice databases, its own file storage account (ADR 0015) and its own mail sender. The accounts in its platform database are therefore the practice's accounts, in the practice's country.
2. **The code keeps ADR 0005's machinery.** The registry, the database per practice, provisioning and the features across practices stay as they are: with one practice they show that one. They are not developed further, and nothing new is built to list or connect practices.
3. **`PRACTICE_SLUG` names the installation's practice** in the web server's environment, required in staging and production. Its page is the root of the domain (`/{locale}`); its own path `/{locale}/{slug}` and a retired slug lead there for good (308); canonical address, `hreflang`, structured data and the sitemap name the root, and the sitemap names nothing else. Unset, as on a developer's machine that runs several demo practices, the root is a neutral page and every practice keeps its own path.
4. **Only the practice's own registered domain.** The installation's proxy obtains its certificate; how is OPS01's.
5. **The practice's brand on its pages and in its e-mails**, with a small "powered by MediBooker" (I02). MediBooker is named as the service provider in the legal pages.

## Consequences

- Operations grow with the practices: every installation is updated, backed up (OPS02) and watched on its own. OPS01 automates the rollout from the same images (ADR 0010).
- Data residency follows the installation: its server and its storage account stand in the practice's country. D9 is decided in part: a server per practice in its country, the provider still open.
- RT-90's concern, personal details outside the practice databases, shrinks: the platform database of an installation belongs to that practice and stands in its country.
- The patient app (D6) cannot list practices: either an app per practice, which Apple's guideline 4.2.6 lets only the practice publish, or one app that a link or QR code binds to one installation. Still the client's decision.
- If one day many practices share a country, ADR 0005's machinery is still there to serve them from one installation; host routing and accounts per practice database would then follow.

## Alternatives considered

- **One platform per region for many practices, each under its own domain:** fewer servers, but host routing, accounts in the practice databases and certificates for many domains first. The user chose against it for the start.
- **Subdomains of a MediBooker domain:** the user wants each practice under its own domain only.
