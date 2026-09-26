// Usage: pnpm admin:create --role ADMIN|DG --name "Full Name" --phone 0803 123 4567 [--replace] [--sms]
// Creates the first ADMIN (only possible here) or the DG as an invited user and prints the setup link.
// Runs wherever the server's NUXT_* settings are available (locally from .env, or on the production host).
import { config } from 'dotenv'
import { createDb } from '../server/db/client.ts'
import { createRegionUser } from '../server/services/admin.ts'
import { inviteUrl } from '../server/services/auth.ts'
import { enqueueSms } from '../server/services/sms.ts'
import { SMS_TEXT } from '../shared/constants/sms-text.ts'
import { USAGE, parseCreateUserArgs } from './admin/args.ts'

config({ quiet: true })

const parsed = parseCreateUserArgs(process.argv.slice(2))
if (!parsed.ok) {
  console.error(`${parsed.error}\n\n${USAGE}`)
  process.exit(1)
}
const { args } = parsed

const url = process.env.NUXT_DATABASE_URL
if (!url) {
  console.error('NUXT_DATABASE_URL is not set. Copy .env.example to .env or export it.')
  process.exit(1)
}
const siteUrl = process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3000'

const { db, client } = createDb(url, { max: 1 })
try {
  const result = await createRegionUser(db, { role: args.role, fullName: args.fullName, phone: args.phone, replace: args.replace, createdBy: null })
  if (result.kind === 'dg_exists') {
    console.error('There is already an active DG. Re-run with --replace to deactivate them and invite this person instead.')
    process.exitCode = 1
  }
  else if (result.kind === 'phone_in_use') {
    console.error('That phone number belongs to an active user. Use a different number, or deactivate that user first.')
    process.exitCode = 1
  }
  else {
    const link = inviteUrl({ otpSecret: '', siteUrl }, result.token)
    if (args.sms) {
      await enqueueSms(db, { to: args.phone, body: SMS_TEXT.invite(link), purpose: 'invite' })
    }
    console.log([
      `Created ${args.role} "${args.fullName}" (${args.phone}) as invited.`,
      ...(result.replacedUserId ? ['The previous DG was deactivated.'] : []),
      '',
      'Open this link on their phone to choose a PIN (valid 72 hours, single use):',
      `  ${link}`,
      '',
      args.sms ? 'The link was also queued as an SMS; the running server sends it within a minute.' : 'Tip: add --sms to also text the link.',
    ].join('\n'))
  }
}
finally {
  await client.end()
}
