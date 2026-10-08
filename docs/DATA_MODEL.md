# Data Model — Tattara

Postgres 17 + PostGIS, Drizzle ORM. Snake_case in the DB, camelCase in TS.
All timestamps are `timestamptz` (UTC). IDs are UUIDv7 unless noted.

## 1. Geography (seeded from INEC; read-mostly)

### `units`
One table for every level: this keeps rollups, scoping and the map uniform.

| Column | Type | Notes |
|---|---|---|
| code | text PK | `19`, `19/05`, `19/05/03`, `19/05/03/012` |
| level | enum `state\|lga\|ward\|pu` | |
| parent_code | text FK → units.code, null for state | |
| name | text | INEC name, as published |
| name_normalised | text | lowercase, no punctuation, for matching/search |
| registered_voters | int null | PU: reported by the PU lead from the field (US-24, task 3.7); the INEC import never overwrites it with NULL, nor a field-reported figure with anything. Aggregates are computed in stats, not stored |
| registered_voters_reported_by | uuid FK users null | the lead who last reported/corrected the figure (NULL for imported figures) |
| registered_voters_reported_at | timestamptz null | when; set together with `_by` (CHECK), and only with a figure |
| location | geography(Point, 4326) null | PU coordinates (INEC) or centroid |
| location_estimated | bool default false | true when `location` is a fallback (e.g. ward centroid), SEED_DATA §1 |
| boundary_ref | text null | GRID3 feature id for joins |
| active | bool default true | INEC occasionally relocates/renames |
| source_version | text | e.g. `inec-2023-01` |
| created_at, updated_at | timestamptz | for the refresh diff (SEED_DATA §6) |

Indexes: `(parent_code)`, `(level)`, `code text_pattern_ops`, GIST on `location`.

CHECKs: the code's shape matches `level` (`SS`, `SS/LL`, `SS/LL/WW`, `SS/LL/WW/PPP`, digits only);
`parent_code` is NULL for a state and otherwise exactly the code minus its last segment; name not blank;
`registered_voters >= 0`. `name_normalised` = `normaliseName(name)` from `shared/utils/text.ts`.

### `unit_targets`
| unit_code PK/FK | target int (≥ 0) | set_by FK users (FK added in 2.1) | set_at |

## 2. People

### `users` (team leads and admins)
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| full_name | text | |
| phone | text unique | E.164 |
| role | enum `ADMIN\|DG\|STATE_LEAD\|LGA_LEAD\|WARD_LEAD\|PU_LEAD` | |
| unit_code | text FK → units.code, null for ADMIN/DG | must match role level |
| pin_hash | text null | argon2id; null until setup |
| status | enum `invited\|active\|locked\|deactivated` | |
| session_version | int default 0 | bump to revoke sessions |
| failed_pin_attempts | int default 0 | |
| locked_until | timestamptz null | |
| invited_by | uuid FK users | |
| created_at, updated_at, last_seen_at | timestamptz | |

| unit_level | enum null | denormalised from `units.level`; with `unit_code` it forms a composite FK → `units(code, level)` |

Constraints: partial unique index — only one `active` user per `(role, unit_code)`.
CHECK: role ↔ `unit_level` (`ROLE_LEVEL` in `shared/constants/roles.ts`; ADMIN/DG have no unit), so with the
composite FK a lead can only sit at a unit of their role's level. CHECK: phone is an E.164 NG mobile;
`status = 'active'` requires `pin_hash`. IDs are server-generated UUIDv7.

### `user_devices`
| id | user_id FK | device_id text | label text | first_seen_at | last_seen_at | revoked_at |

### `invites`
| id | user_id FK | token_hash text | expires_at | used_at | created_by FK |

### `otp_codes`
| id | phone | purpose enum `device\|reset` | code_hash | expires_at | attempts | consumed_at |

## 3. Supporters

### `supporters`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | UUIDv7 from client (idempotency key) |
| pu_code | text FK → units.code | denormalised prefix-scoped key |
| full_name | text | |
| phone | text | E.164 |
| shared_phone | bool default false | |
| address | text | free text / landmark, max 200 chars |
| gender | enum `male\|female` null | |
| age_band | enum `18_24\|25_34\|35_44\|45_54\|55_64\|65_plus` null | |
| support_level | enum `strong\|leaning\|undecided` | |
| has_pvc | enum `yes\|no\|unsure` | yes/no only — never the PVC/VIN number |
| volunteer | bool default false | |
| consent_at | timestamptz NOT NULL | |
| consent_version | text NOT NULL | e.g. `c1-ha` |
| consent_language | enum `ha\|en` | |
| gps | geography(Point,4326) null | |
| gps_accuracy_m | int null | |
| captured_at | timestamptz | device time at capture |
| captured_by | uuid FK users | |
| device_id | text | |
| verification | enum `unverified\|sms_delivered\|callback_verified\|callback_failed\|opted_out` | |
| opted_out_at | timestamptz null | set by a STOP (5.2); kept after anonymisation (opt_out_spike) |
| status | enum `active\|removal_requested\|anonymised` | |
| created_at | timestamptz | server receive time |
| updated_at | timestamptz | server clock; LWW |
| updated_by | uuid FK users | |

Indexes: `pu_code text_pattern_ops`, `(phone)`, `(captured_by, captured_at)`, `(pu_code, created_at)`, GIST `gps`.

CHECKs: `id` is a UUIDv7; `pu_code` has the PU shape (so a supporter sits on a PU, never a ward); phone is E.164 NG
unless anonymised, and an anonymised row has no phone, address or GPS; name 1–120 chars; address ≤ 200;
`consent_version` 1–20 chars (with `consent_at` NOT NULL, the DB refuses records without consent);
`gps_accuracy_m ≥ 0`. Only `server/services/supporters.ts` reads the table (a unit test enforces it).

**Anonymisation** sets: full_name → `'—'`, phone → `null` (phone becomes nullable only when status = anonymised, enforced by a CHECK), address → null, gps → null. Keeps pu_code, the enums and the dates for aggregate integrity.

### `flags`
| id | supporter_id FK null | user_id FK null | pu_code | type enum | details jsonb | status enum `open\|dismissed\|confirmed` | reviewed_by | reviewed_at | review_note text(200) null | created_at |

Indexes: `pu_code text_pattern_ops`, `(status, created_at)`, `(supporter_id)`, `(user_id)`; partial unique
`(supporter_id, type)` where open, `(pu_code, type)` where open for PU flags (no supporter, no user) and `(user_id, type)`
where open for lead flags (no supporter), so the flag engine can re-run (ADR-040). Flag ids from SQL are
`gen_random_uuid()`. CHECK: `reviewed_at` is set exactly when the status is not `open`. `details`
holds evidence only (distances, counts), never names or phones.

Flag types: `gps_far`, `duplicate_phone`, `pu_over_capacity`, `rate_anomaly`, `gps_cluster`, `callback_failed`, `opt_out_spike`.

### `callbacks`
| id | supporter_id FK (unique; on delete cascade) | ward_code FK units | assigned_to FK users null (on delete set null) | due_date date (Lagos) | outcome enum `verified\|wrong_number\|denies\|unreachable` null | notes text(200) | completed_at | completed_by FK users | created_at |

Index `(ward_code, due_date)`. CHECKs: ward code shape; outcome, completed_at and completed_by set together; notes ≤ 200.
The ward code is the scope (a replaced ward lead's open calls go to the new lead). A supporter is sampled at most once (5.3, ADR-042).

## 4. Stats

### `pu_stats` (maintained incrementally)
`pu_code PK, total, verified, flagged_open, male, female, age_18_24 … age_65_plus, strong, leaning, undecided, has_pvc_yes, volunteers, opted_out, last_capture_at, updated_at`

Every supporter row counts in `total` (removal-requested and anonymised too); `verified` = `sms_delivered` or
`callback_verified`; `opted_out` = verification `opted_out`; `last_capture_at` = latest `captured_at`. Updated by
`applyStatDelta` in the supporter write's transaction; `recomputePuStats` rebuilds from scratch (seed, reconcile).
CHECK: every counter ≥ 0.

### `unit_daily_stats`
`unit_code, day date, total, verified` — PK `(unit_code, day)`; written nightly for every unit at every level.

## 5. Messaging and ops

### `sms_queue`
| id | to_phone | body | template_key | purpose enum `thank_you\|otp\|invite\|broadcast\|opt_out_confirm` | scope_code | status enum `queued\|sent\|failed\|delivered` | attempts | next_attempt_at | last_error | provider_ref | created_by | supporter_id FK null (on delete set null) | created_at | sent_at |

Indexes also on `provider_ref` (delivery reports) and `supporter_id`. Finished thank-you and STOP-confirmation rows
are deleted once no live supporter uses the number (hourly anonymisation, 5.2).

### `sms_opt_outs` (5.2)
| phone_hash PK (HMAC-SHA256 of the E.164 number with `NUXT_PHONE_HASH_SECRET`, 64 hex) | created_at |

Numbers that replied STOP. Never the number itself; outlives the anonymised records so no thank-you or broadcast
reaches the number again.

Processed by the `sms:process` Nitro task: claims due rows with `FOR UPDATE SKIP LOCKED` plus a 5-minute lease,
retries with backoff (30 s × 2ⁿ, max 5 attempts). All times use the DB clock. OTP and invite bodies are replaced
with `[redacted]` once sent or finally failed. `last_error` holds provider error text only.

### `sms_templates`
| key PK | body_ha | body_en | approved_by | approved_at |

### `announcements`
| id | scope_code | title | body | created_by | created_at |

### `exports`
| id | scope_code | requested_by | approved_by | status | file_ref | watermark | created_at | expires_at |

### `audit_log` (append-only; no UPDATE/DELETE grants for the app role, and a trigger rejects UPDATE/DELETE/TRUNCATE for every role)
| id bigserial | at | actor_id | actor_role | action text | target_type | target_id | scope_code | ip | meta jsonb |

## 6. Client (Dexie) schema

```ts
// app/offline/db.ts. Version 1 (4.5): meta only. Version 2 (4.2): the rest.
db.version(1).stores({ meta: 'key' })   // session, pinVerifier, unlockFailures; 4.3: lastPullAt, pullUnit, pullStats, storagePersisted
db.version(2).stores({
  supporters: 'id, puCode, phone, syncStatus, capturedAt', // syncStatus pending | synced | rejected (+ rejectReason, issues); pulled rows have no deviceId
  outbox: '++seq, id, kind, createdAt, attempts, nextAttemptAt', // kind 'create' with the SupporterInput payload; nextAttemptAt = backoff
  units: 'code, parentCode', // user's own subtree (PU/Ward leads only), filled by the pull (4.3)
})
```

## 7. Enum source of truth
All enums live in `shared/constants/enums.ts` as `as const` arrays. Zod schemas, Drizzle `pgEnum`s
and i18n label keys derive from them. Never hand-duplicate an enum.
