import { describe, expect, it } from 'vitest'
import { parseCreateUserArgs } from '../../scripts/admin/args'

describe('parseCreateUserArgs', () => {
  it('parses the documented form and normalises the phone', () => {
    expect(parseCreateUserArgs(['--role', 'ADMIN', '--name', '  Umar   Adam Ibrahim ', '--phone', '0806 743 4921'])).toEqual({
      ok: true,
      args: { role: 'ADMIN', fullName: 'Umar Adam Ibrahim', phone: '+2348067434921', replace: false, sms: false },
    })
  })

  it('accepts --key=value, lower-case roles and the boolean flags', () => {
    expect(parseCreateUserArgs(['--role=dg', '--name=Test DG', '--phone=+2348031110001', '--replace', '--sms'])).toEqual({
      ok: true,
      args: { role: 'DG', fullName: 'Test DG', phone: '+2348031110001', replace: true, sms: true },
    })
  })

  it.each([
    [['--role', 'STATE_LEAD', '--name', 'A B', '--phone', '08031110001'], '--role must be ADMIN or DG'],
    [['--name', 'A B', '--phone', '08031110001'], '--role must be ADMIN or DG'],
    [['--role', 'DG', '--phone', '08031110001'], '--name must be 2–120 characters'],
    [['--role', 'DG', '--name', 'A B', '--phone', '12345'], '--phone must be a Nigerian mobile number, e.g. 0803 123 4567'],
    [['--role', 'ADMIN', '--name', 'A B', '--phone', '08031110001', '--replace'], '--replace only applies to --role DG'],
    [['--role', 'DG', '--name'], '--name needs a value'],
    [['--role', 'DG', '--name', '--phone', '08031110001'], '--name needs a value'],
    [['--role', 'DG', '--unit', '19'], 'Unknown option --unit'],
    [['DG'], 'Unexpected argument "DG"'],
  ])('rejects %j', (argv, error) => {
    expect(parseCreateUserArgs(argv)).toEqual({ ok: false, error })
  })
})
