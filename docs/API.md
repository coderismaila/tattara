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
| GET | `/team` | WARD+ | `?unit=` (a unit in scope, not a PU; default: mine) | `{ unit, canManage, members: [{ code, name, level, lead: { id, fullName, status: active\|locked\|invited, phone, lastSeenAt } \| null, qualityScore }] }`. Phones in full for my direct children only, masked deeper |
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
| POST | `/sync/push` | PU | `{ items: SupporterInput[≤50] }` | `{ results }` in item order: `{ id, result: accepted\|duplicate, serverUpdatedAt }`, `{ id \| null, result: rejected, reason, issues? }` (issues = `{ path, message: i18n key }`, never values) or `{ id, result: conflict }`. Each item validated alone (one bad item never blocks the rest). Other roles 403 `not_allowed`; 400 for > 50 items; 120/min per user. Live since 3.3 (the capture page sends one item) |
| GET | `/sync/pull` | PU, WARD | `?since=ISO` | `{ supporters[], stats, announcements[], serverTime }` |

## Stats and map
| GET | `/stats/unit/:code` | scope | | totals, coverage, target, breakdowns, last 30 days |
| GET | `/stats/children/:code` | scope | `?metric=&sort=` | one row per child unit (drives table + choropleth) |
| GET | `/stats/leaderboard/:code` | scope | `?level=lga\|ward\|pu&limit=` | |
| GET | `/stats/inactive/:code` | scope | `?days=3` | leads with no captures in N days |
| GET | `/geo/pus` | scope | `?ward=` | PU points `{ code, name, lat, lng, total, coverage }` |

Stats never include names or phones. `:code` is `all` for the region (DG).

## Review
| GET | `/flags` | WARD+ | `?status=open&type=&unit=` | ward sees supporter names; LGA+ sees masked |
| POST | `/flags/:id/resolve` | WARD+ | `{ status: dismissed\|confirmed, note }` | |
| GET | `/callbacks` | WARD | `?date=` | today's sample |
| POST | `/callbacks/:id` | WARD | `{ outcome, notes? }` | updates supporter.verification |

## Targets
| PUT | `/targets/:code` | parent-level lead of :code, or DG | `{ target }` | |
| POST | `/targets/:code/distribute` | owner of :code | `{ method: 'proportional' }` | splits across children |

## Messaging (v1.1)
| GET | `/sms/templates` | STATE+ | | |
| POST | `/sms/broadcasts` | STATE+ | `{ templateKey, scopeCode, filters }` | returns an estimate first; `confirm: true` to queue |
| POST | `/webhooks/sms` | provider | provider payload | signature check; handles STOP + delivery reports |
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
