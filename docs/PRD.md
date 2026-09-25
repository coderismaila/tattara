# Product Requirements Document — Tattara

**Status:** Draft v1 · **Owner:** Campaign Directorate (DG's office) · **Last updated:** 2026-09-25

## 1. Summary

Tattara is an offline-first Progressive Web App that lets a political party build and track a
consented registry of its supporters across the seven North West states of Nigeria (Jigawa, Kaduna,
Kano, Katsina, Kebbi, Sokoto, Zamfara). Field work is organised on INEC's official electoral
geography, and a live map shows the party's reach at every level, from the whole region down to a
single polling unit.

## 2. Problem

- The party does not know, per polling unit, how many committed supporters it has, so it can't target
  mobilisation, resources or polling agents.
- Existing collection is paper, WhatsApp and Excel: duplicated, padded, un-auditable and invisible to
  leadership until it's too late.
- Field conditions are hard: weak or no network, low-end Android phones, many users more comfortable in
  Hausa than English.

## 3. Goals and non-goals

**Goals**
1. Every PU lead can add a supporter in under 60 seconds, online or offline.
2. Leadership sees near-real-time coverage (supporters ÷ registered voters, as reported by PU leads) at every level on a map.
3. The data is trustworthy: verified phones, GPS evidence, duplicate and anomaly flags, call-back audits.
4. The data is safe: strict scoped access, masking, consent records, audit trail, NDPA-aligned.
5. The same registry powers get-out-the-vote (SMS) and, later, election-day operations.

**Non-goals (v1)**
- Not INEC voter registration and never presented as such.
- No collection of PVC numbers, VINs, NIN, BVN, religion or ethnicity.
- No native iOS/Android app store builds (PWA only).
- No payments, stipends or incentive tracking for supporters.
- No coverage outside the 7 NW states (the data model must not prevent it later).

## 4. Scale

| State | INEC code* | LGAs | Wards | Polling Units |
|---|---|---|---|---|
| Jigawa | 17 | 27 | 287 | 4,522 |
| Kaduna | 18 | 23 | 255 | 8,012 |
| Kano | 19 | 44 | 484 | 11,222 |
| Katsina | 20 | 34 | 361 | 6,652 |
| Kebbi | 21 | 21 | 225 | 3,743 |
| Sokoto | 33 | 23 | 244 | 3,991 |
| Zamfara | 36 | 14 | 147 | 3,529 |
| **Total** | | **186** | **2,003** | **41,671** |

\*Codes, LGA and ward counts must be verified against the imported INEC dataset. The seed data is the source of truth, not this table.

- **Users:** ~43,900 (1 DG + 7 state + 186 LGA + 2,003 ward + 41,671 PU leads) plus admins.
- **Supporters:** plan for up to 8 million records (NW has 20M+ registered voters).
- **Peak write load:** launch drives; assume 40k leads × 30 records/hour ≈ 330 writes/sec burst after offline sync.

## 5. Users and roles

| Role | Code | Scope | Primary jobs |
|---|---|---|---|
| Director-General | `DG` | All NW | See the whole map, set targets, approve exports, broadcast SMS |
| State Team Lead | `STATE_LEAD` | One state | Onboard LGA leads, monitor LGAs, resolve escalations |
| LGA Team Lead | `LGA_LEAD` | One LGA | Onboard ward leads, monitor wards, review flags |
| Ward Team Lead | `WARD_LEAD` | One ward | Onboard PU leads, call-back verification, review flags |
| PU Team Lead | `PU_LEAD` | One PU | Add and manage supporters at their PU |
| System Admin | `ADMIN` | Technical | Seed data, user recovery, config; no bulk supporter access by default |

Each lead creates the accounts one level below them (cascading onboarding). The DG is created by an admin.

## 6. User stories and requirements

### 6.1 Accounts and onboarding
- **US-1** As a lead, I can invite a lead for a unit directly below me by entering their name and phone; they receive an SMS with a one-time setup code.
- **US-2** As an invited lead, I set a 6-digit PIN and bind my device with an SMS OTP.
- **US-3** As a lead, I can deactivate or replace a lead below me (with a reason; audited).
- **R-1** One active lead per unit. A replacement deactivates the previous lead; their records stay attributed to them.
- **R-2** Login is phone + PIN. A new device requires an SMS OTP. Five failed PIN attempts lock the account for 15 minutes.

### 6.2 Supporter capture (PU lead)
- **US-4** I can add a supporter with: full name, phone, address/landmark, gender, age band, support level, has-PVC (yes/no/unsure), willing-to-volunteer, and a consent confirmation.
- **US-5** State, LGA, ward and PU are filled in automatically from my assignment and can't be edited.
- **US-6** I can add supporters with no network; they sync automatically when signal returns, and I can see what's pending.
- **US-7** I get an immediate warning if the phone number already exists in my PU (offline check) or anywhere (online check).
- **US-8** I can view, search and edit supporters I registered; I cannot hard-delete (only request removal).
- **US-24** I record the number of registered voters at my PU (from the register displayed at the PU) and can update it; my ward lead can correct it. INEC does not publish these per PU, so the field is the source.
- **R-3** Consent screen: a short script shown in the active language that the lead reads aloud; the lead ticks "Supporter agreed". Consent version and language are stored.
- **R-4** GPS location and accuracy are captured when available; saving is never blocked by lack of GPS.
- **R-5** Phone numbers are normalised to E.164 (+234). Shared household phones are allowed with a "shared phone" tick, max 3 supporters per number system-wide.

### 6.3 Verification and data quality
- **US-9** After sync, the supporter receives an SMS: a thank-you plus an opt-out ("Reply STOP"). Replies update the record.
- **US-10** As a ward lead, I get a daily random sample (default 5%) of new supporters in my ward to call back and mark verified / wrong number / denies / unreachable.
- **R-6** Automatic flags: GPS > configurable distance from PU (default 3 km); duplicate phone; PU count > 90% of its registered voters (as reported by the PU lead; not checked until reported); capture rate anomaly (> 60 records/hour per lead); many records with identical GPS fix.
- **R-7** Each lead has a **quality score** (verified rate, flag rate, opt-out rate), shown to their supervisors.

### 6.4 Dashboards and map
- **US-11** As any lead, I see my unit's totals, coverage %, target, progress over time and a ranked table of units below me.
- **US-12** As STATE/LGA/DG, I see an interactive map coloured by coverage; tapping a unit drills down (State → LGA → Ward → PU points).
- **US-13** I can switch the map metric: coverage %, total supporters, vs target, verified %, flags, active leads.
- **US-14** I see a leaderboard and an "inactive leads" list (no records in N days).
- **R-8** Dashboard numbers are no more than 5 minutes stale.
- **R-9** Above ward level, no individual supporter data is shown — aggregates only.

### 6.5 Targets
- **US-15** DG sets state targets; each lead may split their target across child units (defaulting to proportional by reported registered voters, or by PU count where figures are missing).

### 6.6 Communication (Phase 2)
- **US-16** DG and state leads can send approved SMS templates to supporters in scope (e.g. PVC collection reminders, rally notices, election-day reminders), with opt-outs honoured and every send audited.
- **US-17** Leads receive in-app announcements from above.

### 6.7 Data rights and admin
- **US-18** A supporter can ask to be removed (via SMS STOP or via their lead); removal anonymises the record within 72 hours.
- **US-19** DG can request an export for a scope; it requires a second approver (ADMIN) and is watermarked and audited.
- **US-20** Admin can import and refresh INEC geography. (Registered-voter counts come from PU leads, US-24.)

### 6.8 Election day (Phase 3, post-MVP)
- **US-21** PU leads mark supporters as "voted" to drive live turnout tracking.
- **US-22** PU agents upload a photo of the EC8A result sheet and enter the figures; the system compares them with the INEC IReV upload and flags mismatches.
- **US-23** Incident reporting (violence, BVAS failure, late materials) with photo and GPS.

## 7. Non-functional requirements

| Area | Requirement |
|---|---|
| Offline | Capture, supporter list and own-unit stats work fully offline after first login. Queue survives app restarts. |
| Performance | Capture screen interactive < 3 s on 3G / Android Go, first load; < 1 s repeat. Capture route JS < 150 KB gz. |
| Devices | Android 9+, Chrome 100+. Installable PWA. Works at 360 px width. |
| Language | Hausa (default) and English, switchable anytime. Native-speaker reviewed before pilot. |
| Availability | 99.5% monthly; offline capture means outages don't stop field work. |
| Security | See SECURITY_PRIVACY.md. OWASP ASVS L2 as the benchmark. |
| Privacy | NDPA 2023 compliant: consent, purpose limitation, DPIA, retention, subject rights. |
| Observability | Structured logs, error tracking, sync-failure metrics, SMS delivery metrics. |
| Accessibility | WCAG 2.2 AA for contrast and touch targets (≥ 44 px). |

## 8. Success metrics

- ≥ 90% of PU leads active within 2 weeks of onboarding in pilot LGAs.
- Median capture time ≤ 60 s.
- ≥ 85% call-back verification pass rate.
- Sync success ≥ 99% within 24 h of capture.
- Zero data leaks; zero unscoped-access defects in security testing.

## 9. Release plan

| Release | Contents |
|---|---|
| **MVP (pilot)** | Accounts and cascade onboarding, capture (offline), sync, SMS thank-you/opt-out, flags, lead dashboards, map to ward level, Hausa/English. Pilot: 2 LGAs. |
| **v1.0 (NW rollout)** | Call-back workflow, quality scores, targets, PU-level map, exports with approval, admin tooling, load-tested. |
| **v1.1** | SMS broadcasts, announcements, inactive-lead nudges. |
| **v2 (election)** | Turnout marking, EC8A capture and IReV comparison, incident reporting, agent management. |

## 10. Open questions

1. Hosting and data residency: Nigerian cloud vs international provider with an NDPA-compliant transfer basis? (Legal to decide.)
2. Is PU-level registered-voter data available in machine-readable form for all 41,671 PUs? If not, coverage uses ward-level estimates.
3. SMS sender ID and budget (at 8M supporters, one SMS each is a large cost; confirm the per-SMS rate).
4. Who is the Data Protection Officer?
5. Should PU leads be able to register supporters who live elsewhere but vote at their PU? (Assumed yes: registration follows the voting PU.)
