# API — Tattara

All routes are under `/api`, return JSON, and use cookie sessions. Every input is validated with the shared Zod schemas
(`readValidatedBody` / `getValidatedQuery`). Errors follow `{ statusCode, message, data? }`.
"Scope" means the caller's unit prefix (see ARCHITECTURE §4). Role column = minimum role unless stated.

## Auth
| Method | Path | Who | Body / Query | Notes |
|---|---|---|---|---|
| POST | `/auth/login` | public | `{ phone, pin, deviceId }` | 200 session, or 202 `{ otpRequired: true }` for a new device |
| POST | `/auth/otp/verify` | public | `{ phone, code, deviceId }` | binds device, sets session |
| POST | `/auth/otp/resend` | public | `{ phone }` | rate-limited |
| POST | `/auth/setup` | public | `{ token, pin, deviceId }` | from invite; activates user |
| POST | `/auth/logout` | any | — | |
| GET | `/auth/me` | any | — | `{ user, unit, scope }` |

## Team (users below me)
| GET | `/team` | WARD+ | `?unit=` (child units of scope) | children units with lead status + quality score |
| POST | `/team/invite` | WARD+ | `{ unitCode, fullName, phone }` | unitCode must be a **direct child** of the caller's unit |
| POST | `/team/:userId/deactivate` | WARD+ | `{ reason }` | audited; bumps session_version |
| POST | `/team/:userId/reset-pin` | WARD+ | — | sends a new invite |

## Supporters
| GET | `/supporters` | PU, WARD | `?q=&pu=&cursor=&limit=` | full phone for PU/WARD; 403 above ward |
| GET | `/supporters/:id` | PU, WARD | | |
| PATCH | `/supporters/:id` | PU (own PU) | partial supporter | LWW; audited field diff (names of fields only) |
| POST | `/supporters/:id/removal` | PU, WARD | `{ reason }` | status → removal_requested |
| GET | `/supporters/check-phone` | PU | `?phone=` | `{ countInSystem, samePu: bool }` — no names returned |

## Sync
| POST | `/sync/push` | PU | `{ items: SupporterInput[≤50] }` | per-item `{ id, result, reason?, serverUpdatedAt }` |
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

## Admin
| POST | `/admin/import/units` | ADMIN | multipart | validates + dry-run diff, then apply |
| POST | `/admin/users/dg` | ADMIN | `{ fullName, phone }` | |
| GET | `/admin/audit` | ADMIN, DG | filters | |

## Conventions
- Pagination: cursor-based (`cursor` = last id), default 50, max 200.
- `/sync/push` item result reasons: `invalid`, `no_consent`, `out_of_scope`, `phone_limit`, `pu_inactive`.
- All mutating routes are CSRF-safe via SameSite=Lax cookies + an `Origin` header check.
