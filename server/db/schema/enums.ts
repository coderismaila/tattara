// Postgres enums derive from shared/constants/enums.ts (the single source of truth, DATA_MODEL §7).
import { pgEnum } from 'drizzle-orm/pg-core'
import { UNIT_LEVELS } from '../../../shared/constants/enums.ts'

export const unitLevel = pgEnum('unit_level', UNIT_LEVELS)
