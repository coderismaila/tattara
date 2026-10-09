# API — Tattara

All routes are under `/api`, return JSON, and use cookie sessions. Every input is validated with the shared Zod schemas
(`readValidatedBody` / `getValidatedQuery`). Errors follow `{ statusCode, message, data? }`.
"Scope" means the caller's unit prefix (see ARCHITECTURE §4). Role column = minimum role unless stated.

## Auth
| Method | Path | Who | Body / Query | Notes |
|---|---|---|---|---|
| POST | `/auth/login` | public | `{ phone, pin, deviceId }` | 200 session, or 202 `{ otpRequired: true }` for a new device. 401 `invalid_credentials` (same for unknown phone and wrong PIN), 423 `locked` + `retryAfterSec`, 429 `rate_limited` (10/15 min per phone, or 3 OTP sends/hour) |
| POST | `/auth/otp/verify` | public | `{ phone, code, deviceId }` | binds device, sets session. 401 `code_invalid` / `code_expired` / `code_attempts`. The code only works for the device that passed the PIN check |
| POST | `/auth/otp/resend` | public | `{ phone }` | always 202 (reveals nothing) unless 429; only resends for a pending PIN-verified login |
| POST | `/auth/setup` | public | `{ token, pin, deviceId }` | from invite; activates user, trusts the device, bumps session_version. 400 `invite_invalid`, 410 `invite_expired`, 409 `unit_taken`; weak PINs rejected (400) |
| POST | `/auth/logout` | any | — | clears the session |
| GET | `/auth/me` | any | — | `{ user: { id, fullName, role, unitCode }, unit, scope }`; 401 once the session is revoked or expired (below) |

Errors carry `data.reason` (and `data.issues` with i18n keys for 400 `invalid`). Every authenticated route calls
`requireAuth` (active user, same `session_version`, device not revoked, active within 30 days).

## Team (users below me)
| GET | `/team` | WARD+ | `?unit=` (a unit in scope, not a PU; default: mine) | `{ unit, canManage, members: [{ code, name, level, lead: { id, fullName, status: active\|locked\|invited, phone, lastSeenAt } \| null, qualityScore, quality: { verifiedRate, flagRate, optOutRate, passRate, supporters, computedAt } \| null }] }`. Phones in full for my direct children only, masked deeper |
| POST | `/team/invite` | WARD+ | `{ unitCode, fullName, phone, replace? }` | unitCode must be a **direct child** of the caller's unit (403 `not_your_unit`). 409 `unit_has_active_lead` unless `replace: true` (which deactivates the current lead), `already_active`, `phone_in_use`. Supersedes other pending invites for the unit; re-inviting the same pending person resends. 100/hour per inviter |
| POST | `/team/:userId/deactivate` | WARD+ | `{ reason }` | direct children only (403, also for unknown ids); audited with the reason (a phone in it → 400); bumps session_version, revokes devices; 409 `already_deactivated` |
| POST | `/team/:userId/reset-pin` | WARD+ | — | direct children only; back to invited with no PIN, sessions and devices revoked, new invite SMS; audited |

WARD+ here means WARD_LEAD, LGA_LEAD, STATE_LEAD and DG (DG manages the state leads). ADMIN → DG is `/admin/users/dg`.

## Supporters
| GET | `/supporters` | PU, WARD | `?q=&pu=&cursor=&limit=` | `{ items, nextCursor }`, newest first (cursor = last id; UUIDv7 is time-ordered), limit 50 (max 200). `q`: name contains, full phone, or ≥ 4 trailing digits. PU lead: own PU; ward lead: own ward, `pu` must be in it (else 403). Anonymised records left out. 403 above ward |
| GET | `/supporters/:id` | PU, WARD | | `{ supporter, canEdit }`; unknown, anonymised and out-of-scope ids all 404 |
| PATCH | `/supporters/:id` | PU (own PU) | editable fields only (`supporterPatchSchema`) | `{ supporter, changed }`; LWW; audited field diff (names of fields only); 409 `phone_limit` when the new number already has 3 supporters; ward lead 403; others 404 |
| POST | `/supporters/:id/removal` | PU, WARD | `{ reason }` | status → removal_requested (still counted in pu_stats); audited with the reason (a phone in it → 400); 409 `already_requested`; 404 out of scope |
| GET | `/supporters/check-phone` | PU | `?phone=` | `{ countInSystem, samePu, limitReached }`: counts only (no names, PUs or ids); 60/min per user; other roles 403 |

## Sync
| POST | `/sync/push` | PU | `{ items: SupporterInput[≤50] }` | `{ results }` in item order: `{ id, result: accepted\|duplicate, serverUpdatedAt }`, `{ id \| null, result: rejected, reason, issues? }` (issues = `{ path, message: i18n key }`, never values) or `{ id, result: conflict }`. Each item validated alone (one bad item never blocks the rest). Other roles 403 `not_allowed`; 400 for > 50 items; 120/min per user. Sent by the sync engine (4.3) and by the service worker on Background Sync |
| GET | `/sync/pull` | PU, WARD | `?since=ISO&cursor=` | `{ supporters[], units[], stats, announcements[], serverTime, nextCursor }`. The caller's own unit only (PU lead: their PU; ward lead: their ward), full records; anonymised ones as `{ id, deleted: true }`. Oldest change first, 500 per page; follow `nextCursor` (`<ms>_<uuid>`) with the same `since`, and use the first page's `serverTime` as the next `since` (it is 2 min before the server clock, so pulls overlap). `units` (the subtree) on the first page only; `stats` = summed `pu_stats` (`total`, `verified`, `flaggedOpen`, `lastCaptureAt`); `announcements` always `[]` until v1.1. Others 403 `not_allowed`; 60/min per user (task 4.3) |

## Stats and map
| GET | `/stats/unit/:code` | scope (admin included: aggregates) | | `{ unit, totals { supporters, verified, flaggedOpen, optedOut, volunteers, hasPvcYes, support, gender, age }, registeredVoters { sum, pusWithFigure, totalPus }, coverage, target, progress, lastCaptureAt, last30Days[], computedAt }`. Coverage = supporters on PUs with a figure ÷ those figures (ADR-033). Cached 60 s per unit (task 6.1) |
| GET | `/stats/children/:code` | scope (admin included) | `?metric=coverage\|supporters\|verifiedRate\|flaggedOpen\|progress\|activeLeads&sort=asc\|desc` (default coverage asc) | `{ unit, metric, sort, children: [{ code, name, level, supporters, verified, verifiedRate, flaggedOpen, registeredVoters, coverage, target, progress, activeLeads }], computedAt }`; units without a value last; `[]` below a PU. Cached 60 s per unit/metric/order (task 6.1) |
| GET | `/stats/leaderboard/:code` | scope (admin included: aggregates) | `?level=state|lga|ward|pu&metric=recent|progress|coverage&limit=` (level below :code, default one down; metric default `recent` = captured in the last 7 days; limit 1–100, default 20) | `{ unit, level, metric, total, rows: [{ rank, code, name, value, recent, supporters, progress, coverage }], computedAt }`; no value ranks last; 400 for a level not below :code. Cached 60 s (task 6.5, ADR-049) |
| GET | `/stats/inactive/:code` | WARD, LGA, STATE, DG in scope (not admin, not PU) | `?days=3` (1–30) | `{ unit, days, inactive: [{ userId, name, unitCode, unitName, lastCaptureAt, lastSeenAt, daysInactive }], inactiveTotal, notStarted: [{ userId, name, role, unitCode, unitName, invitedAt, daysSinceInvite }], notStartedTotal, computedAt }`: active PU leads with no captures in N days (from setting up when none), and leads invited below :code who never set up. Names, never phone numbers; ≤ 200 per list. Cached 60 s (task 6.5, ADR-049) |
| GET | `/geo/pus` | scope (admin included) | `?ward=19-05-03` | `{ ward, points: [{ code, name, lat, lng, locationEstimated, total, coverage }] }`: active PUs with a location; 400 for a non-ward code; cached 60 s (task 6.3) |

Stats never include names or phones. `:code` is `all` for the region (DG).

## Review
| GET | `/flags` | WARD, LGA, STATE (own unit), DG (all) | `?status=open\|reviewed&type=&unit=&cursor=&limit=` (50, max 100) | `{ items, nextCursor, openCounts }`, newest first; cursor `<ms>_<id>`. Each item: `type, status, puCode, createdAt, details` (evidence), `subject` (`supporter`: full for ward leads, masked above; `lead`: name + unit; `pu`), `reviewedAt, reviewedBy { fullName }, reviewNote`. `unit` outside scope 403; PU leads and admin 403 (task 5.4) |
| POST | `/flags/:id/resolve` | WARD, LGA, STATE, DG in scope | `{ status: dismissed\|confirmed, note? }` (≤ 200, no phone numbers) | `{ flag: { id, status } }`. A reviewed flag can be reviewed again (latest wins: a supervisor overrules). Refreshes `pu_stats.flagged_open`; audited `flag.resolve` with type and from/to, never the note. Out of scope 404, other roles 403 |
| GET | `/callbacks` | WARD | `?date=YYYY-MM-DD` (default today, Lagos) | `{ date, items, passRate }`: the ward's calls due that day plus any still open from earlier days (oldest first), each with the supporter's name, phone, PU, capture time and verification; anonymised ones left out. `passRate` = verified ÷ (verified + wrong number + denies) over 30 days, unreachable counted apart. Other roles 403 |
| POST | `/callbacks/:id` | WARD | `{ outcome: verified\|wrong_number\|denies\|unreachable, notes? }` (notes ≤ 200, no phone numbers) | `{ item: { id, outcome, verification } }`. verified → `callback_verified`; wrong number / denies → `callback_failed` + a `callback_failed` flag; unreachable → no change; an opted-out or anonymised supporter keeps its state. Audited (outcome, never notes). Once only: 409 `already_done`. Another ward's lead 404, other roles 403 |

## Targets
| PUT | `/targets/:code` | DG for a state; otherwise the lead of the unit directly above :code | `{ target }` (whole number, 0–10,000,000) | `{ code, target, previous }`. Audited `target.set` (from/to). Out of scope 403, other callers 403, unknown/inactive unit 404 (task 6.4, ADR-048) |
| POST | `/targets/:code/distribute` | the lead of :code (state, LGA, ward) | `{ method: 'proportional', preview?: boolean }` | `{ code, target, basis: registered_voters|pu_count, children: [{ code, name, weight, target, previous }], saved }`. Splits the own target across the active units below (largest remainder, adds up exactly); registered voters only when every PU below has a figure, else PU count. `preview` saves nothing. 409 `no_target` / `no_children`. Audited `target.distribute` when saved |

## Messaging (v1.1)
| GET | `/sms/templates` | STATE+ | | |
| POST | `/sms/broadcasts` | STATE+ | `{ templateKey, scopeCode, filters }` | returns an estimate first; `confirm: true` to queue |
| POST | `/webhooks/sms` | provider | provider payload | No session. `X-Termii-Signature` = HMAC-SHA512 of the raw body with `NUXT_SMS_WEBHOOK_SECRET`, else 401; 404 while no secret is set; 600/min per IP. Delivery reports mark the SMS delivered/failed (a delivered thank-you verifies the number's supporters); an inbound STOP (or variant) opts the number out. Unknown events → 200 `{ ok, handled: 'ignored' }` (task 5.2, live in MVP) |
| GET/POST | `/announcements` | read: any in scope; write: LGA+ | | |

## Exports
| POST | `/exports` | DG, STATE | `{ scopeCode, fields[] }` | status `pending_approval` |
| POST | `/exports/:id/approve` | ADMIN | | generates a watermarked CSV, 24 h link |
| GET | `/exports/:id/download` | requester | | single-use, audited |

## Units
| Method | Path | Who | Body / Query | Notes |
|---|---|---|---|---|
| GET | `/units/:code/registered-voters` | anyone whose scope contains `:code` (admin included: aggregates) | | PU: `{ registeredVoters, reportedAt }`; ward and above: sum over PUs with a figure + `pusWithFigure` / `totalPus` ("reported for X of Y"). `:code` = `all` for the region (DG, admin) |
| PUT | `/units/:code/registered-voters` | the PU's own lead, or its ward lead | `{ registeredVoters: 0–10000 }` | records who and when; audited `{ from, to }`; others 403 |

Unit codes in URL paths use dashes: `19/05/03` → `19-05-03` (`toUrlCode` / `fromUrlCode` in `shared/utils/pu-code.ts`); `all` = the region.

## Admin
| POST | `/admin/import/units` | ADMIN | multipart | validates + dry-run diff, then apply |
| GET | `/admin/dg` | ADMIN | | `{ dg: { id, fullName, status: active\|locked\|invited, phone (masked), lastSeenAt } \| null }` (active DG, else the pending invite) |
| POST | `/admin/users/dg` | ADMIN | `{ fullName, phone, replace? }` | invites the DG by SMS; 409 `dg_exists` unless `replace: true` (deactivates the current DG), `phone_in_use`. Supersedes a pending DG invite; same person → resend. Never returns the token. Other roles: 403 `admin_only`. ADMINs are created only by `pnpm admin:create` |
| GET | `/admin/audit` | ADMIN, DG | filters | |

## Conventions
- Pagination: cursor-based (`cursor` = last id), default 50, max 200.
- `/sync/push` item result reasons: `invalid`, `no_consent`, `out_of_scope`, `phone_limit` (a 4th supporter on one number, PRD R-5), `pu_inactive`.
- All mutating routes are CSRF-safe via SameSite=Lax cookies + an `Origin` header check.
- Every authenticated route answers 401 with `data.reason`: `revoked` (deactivated, PIN reset, device revoked → the
  client wipes its local data) or `expired` (no session, or 30 days idle → the client keeps its data for the same
  lead's next sign-in).
