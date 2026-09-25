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
| registered_voters | int null | INEC figure; PU level primary, others = sum |
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

Constraint: partial unique index — only one `active` user per `(role, unit_code)`.

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
| status | enum `active\|removal_requested\|anonymised` | |
| created_at | timestamptz | server receive time |
| updated_at | timestamptz | server clock; LWW |
| updated_by | uuid FK users | |

Indexes: `pu_code text_pattern_ops`, `(phone)`, `(captured_by, captured_at)`, `(pu_code, created_at)`, GIST `gps`.

**Anonymisation** sets: full_name → `'—'`, phone → `null` (phone becomes nullable only when status = anonymised, enforced by a CHECK), address → null, gps → null. Keeps pu_code, the enums and the dates for aggregate integrity.

### `flags`
| id | supporter_id FK null | user_id FK null | pu_code | type enum | details jsonb | status enum `open\|dismissed\|confirmed` | reviewed_by | reviewed_at | created_at |

Flag types: `gps_far`, `duplicate_phone`, `pu_over_capacity`, `rate_anomaly`, `gps_cluster`, `callback_failed`, `opt_out_spike`.

### `callbacks`
| id | supporter_id FK | assigned_to FK users | due_date date | outcome enum `verified\|wrong_number\|denies\|unreachable` null | notes text(200) | completed_at |

## 4. Stats

### `pu_stats` (maintained incrementally)
`pu_code PK, total, verified, flagged_open, male, female, age_18_24 … age_65_plus, strong, leaning, undecided, has_pvc_yes, volunteers, opted_out, last_capture_at, updated_at`

### `unit_daily_stats`
`unit_code, day date, total, verified` — PK `(unit_code, day)`; written nightly for every unit at every level.

## 5. Messaging and ops

### `sms_queue`
| id | to_phone | body | template_key | purpose enum `thank_you\|otp\|invite\|broadcast` | scope_code | status enum `queued\|sent\|failed\|delivered` | attempts | provider_ref | created_by | created_at | sent_at |

### `sms_templates`
| key PK | body_ha | body_en | approved_by | approved_at |

### `announcements`
| id | scope_code | title | body | created_by | created_at |

### `exports`
| id | scope_code | requested_by | approved_by | status | file_ref | watermark | created_at | expires_at |

### `audit_log` (append-only; no UPDATE/DELETE grants for the app role)
| id bigserial | at | actor_id | actor_role | action text | target_type | target_id | scope_code | ip | meta jsonb |

## 6. Client (Dexie) schema

```ts
db.version(1).stores({
  supporters: 'id, puCode, phone, syncStatus, capturedAt',
  outbox: '++seq, id, kind, createdAt, attempts, nextAttemptAt',
  meta: 'key',          // session snapshot, lastPullAt, myUnit, consentText
  units: 'code, parentCode', // user's own subtree (PU/Ward leads only)
})
```

## 7. Enum source of truth
All enums live in `shared/constants/enums.ts` as `as const` arrays. Zod schemas, Drizzle `pgEnum`s
and i18n label keys derive from them. Never hand-duplicate an enum.
