// Argument parsing for `pnpm admin:create` (pure, unit-tested).
import { normalizePhone } from '../../shared/utils/phone.ts'
import type { RegionRole } from '../../server/services/admin.ts'

export interface CreateUserArgs {
  role: RegionRole
  fullName: string
  phone: string
  replace: boolean
  sms: boolean
}

export const USAGE = `Usage: pnpm admin:create --role ADMIN|DG --name "Full Name" --phone 0803 123 4567 [--replace] [--sms]

  --role     ADMIN (only this command can create one) or DG (one active DG at a time)
  --name     the person's full name
  --phone    Nigerian mobile; the setup link is for this person
  --replace  DG only: deactivate the current DG as part of this step
  --sms      also text the setup link (the running server sends it within a minute);
             without it the link is only printed here`

export type ParseResult = { ok: true, args: CreateUserArgs } | { ok: false, error: string }

/** Accepts `--flag value`, `--flag=value` and bare booleans; the phone may contain spaces if quoted. */
export function parseCreateUserArgs(argv: readonly string[]): ParseResult {
  const values = new Map<string, string>()
  const flags = new Set<string>()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (!arg.startsWith('--')) return { ok: false, error: `Unexpected argument "${arg}"` }
    const [key, inline] = arg.slice(2).split(/=(.*)/s, 2) as [string, string | undefined]
    if (key === 'replace' || key === 'sms') {
      flags.add(key)
      continue
    }
    if (!['role', 'name', 'phone'].includes(key)) return { ok: false, error: `Unknown option --${key}` }
    const value = inline ?? argv[++i]
    if (value === undefined || value.startsWith('--')) return { ok: false, error: `--${key} needs a value` }
    values.set(key, value)
  }

  const role = values.get('role')?.toUpperCase()
  if (role !== 'ADMIN' && role !== 'DG') return { ok: false, error: '--role must be ADMIN or DG' }
  const fullName = (values.get('name') ?? '').trim().replace(/\s+/g, ' ')
  if (fullName.length < 2 || fullName.length > 120) return { ok: false, error: '--name must be 2–120 characters' }
  const phone = normalizePhone(values.get('phone') ?? '')
  if (!phone) return { ok: false, error: '--phone must be a Nigerian mobile number, e.g. 0803 123 4567' }
  if (flags.has('replace') && role !== 'DG') return { ok: false, error: '--replace only applies to --role DG' }

  return { ok: true, args: { role, fullName, phone, replace: flags.has('replace'), sms: flags.has('sms') } }
}
