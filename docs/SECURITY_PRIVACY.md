# Security & Privacy — Tattara

> This dataset links named, reachable people to a political affiliation in a region with
> active insecurity. A leak could get people hurt. Treat every rule here as a hard requirement.
> This document is engineering guidance, not legal advice. A Nigerian data protection lawyer must
> review the DPIA and consent text before the pilot.

## 1. Legal frame (Nigeria Data Protection Act 2023)

- Political opinions are **sensitive personal data** under the NDPA. Our lawful basis is **explicit, specific, withdrawable consent**.
- A **Data Protection Impact Assessment (DPIA)** is required before processing because this is high-risk processing. Owner: DPO. Template: `docs/templates/DPIA.md` (to be written by legal).
- Purpose limitation: data is used only for party mobilisation and communication with the supporter. No sale or sharing with third parties.
- Data subject rights: access, correction, withdrawal (STOP → anonymise within 72 h), erasure.
- Cross-border transfer: only with a valid NDPA transfer basis. The hosting decision is recorded in DECISIONS.md.
- Retention: supporter records are anonymised 12 months after the last general election they were collected for, unless the supporter re-consents.

## 2. Consent

Stored per record: `consent_at`, `consent_version`, `consent_language`. Consent texts live in
`shared/constants/consent.ts`, versioned (`c1-ha`, `c1-en`, …). The server rejects records without consent.

Draft consent script (for legal review; the Hausa version needs a native translator):

> "[Party] is keeping a list of its supporters to contact you about party activities and
> elections. We will record your name, phone number, address and polling unit. Only party
> coordinators for your area can see your details. We will send you an SMS; you can reply
> STOP at any time to be removed. Do you agree?"

## 3. Role-based access matrix

| Data / action | PU | WARD | LGA | STATE | DG | ADMIN |
|---|---|---|---|---|---|---|
| Add supporter | own PU | — | — | — | — | — |
| View supporter full details | own PU | own ward | — | — | — | — |
| View supporter masked (name initials, `+234 80* *** 1234`) | — | — | flag review only | — | — | — |
| Aggregates / map | own PU | own ward | own LGA | own state | all | all |
| Invite/deactivate leads | — | PU leads | ward leads | LGA leads | state leads | DG |
| Flags review | — | ✓ | ✓ (masked) | ✓ (masked) | ✓ (masked) | — |
| SMS broadcast | — | — | — | own state | all | — |
| Request export | — | — | — | own state | all | — |
| Approve export | — | — | — | — | — | ✓ |
| Audit log | — | — | — | — | read | read |

ADMIN has no default read access to supporter PII; break-glass access requires a DG-approved ticket and is audited.

## 4. Enforcement in code

- `server/utils/scope.ts` is the **only** way to build supporter/user queries. A lint rule or
  test ensures no `db.select().from(supporters)` exists outside `server/services/`.
- **Serialisers:** `serializeSupporter(record, viewerRole)` in `server/services/supporters.ts` does the masking.
  API routes never return raw DB rows.
- **Tests (required):** for every supporter/user/stats route, a table-driven test asserts that
  each role in and out of scope gets the correct status and fields. See IMPLEMENTATION_PLAN task 3.6.

## 5. Authentication and sessions
- PINs hashed with argon2id (memory ≥ 19 MiB). Never log PINs or OTPs.
- OTPs: 6 digits, 10-min expiry, 5 attempts, hashed at rest.
- Invite tokens: 128-bit random, hashed at rest, 72 h expiry, single use.
- Sessions: sealed cookies, `HttpOnly`, `Secure`, `SameSite=Lax`, 30-day sliding; revocable by `session_version`.
- Lockout: 5 failed PINs → 15 min lock; alert the supervising lead after 3 lockouts in 24 h.

## 6. Transport and platform
- HTTPS only, HSTS, strict CSP (no inline scripts except what Nuxt requires, with nonces if feasible),
  `X-Content-Type-Options`, `Referrer-Policy: same-origin`, `Permissions-Policy` restricting everything but geolocation.
- The DB is not publicly reachable. The app DB role has least privilege; `audit_log` is INSERT-only for the app role.
- Encrypted backups with PITR; restore tested quarterly.
- Dependencies: `pnpm audit` in CI; Renovate for updates; track Nuxt security advisories (there were critical fixes in 2026 — stay on the latest 4.5.x patch).

## 7. On the device
- Data in IndexedDB is readable by anyone who unlocks the phone. Mitigations:
  - PU leads only ever hold their own PU's supporters; ward leads hold only their ward's.
  - Auto-lock the app after 5 min idle → PIN re-entry (offline-verifiable via a locally stored PIN verifier: PBKDF2 with a high iteration count).
  - "Wipe this device" on logout and remotely on deactivate (next online contact clears Dexie).
  - No supporter data in the SW cache, URLs, or `localStorage`.

## 8. Logging
- Never log names, phone numbers, addresses or GPS. Log IDs and PU codes only.
- Error tracking with PII scrubbing on both client and server.

## 9. Exports
- Two-person rule (DG/STATE request → ADMIN approve).
- CSV watermarked with the export id in a column + filename; download link single-use, 24 h.
- Audited, with the row count recorded.

## 10. SMS
- Only approved templates for broadcasts; honour opt-outs globally; daily caps per scope.
- Sender ID registered with the provider; no links to untrusted domains.

## 11. Things the system must never do
- Collect PVC numbers, VINs, NIN, BVN, religion, ethnicity, or photos of supporters/PVCs.
- Record or facilitate any payment or inducement to supporters (Electoral Act offences).
- Present itself as INEC or as voter registration.
- Share supporter lists with unverified third parties.
