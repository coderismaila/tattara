// SECURITY_PRIVACY §4: supporter rows are read only in server/services/ (which scope and serialise them).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '../..')
const SCANNED = ['server', 'app', 'shared', 'scripts']
const ALLOWED = `server${sep}services${sep}`

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'node_modules' || name === 'migrations' ? [] : files(path)
    return /\.(?:ts|vue|mjs|js)$/.test(name) ? [path] : []
  })
}

describe('supporter data access', () => {
  it('no code outside server/services/ selects from the supporters table', () => {
    const offenders = SCANNED.flatMap(d => files(join(ROOT, d)))
      .map(f => relative(ROOT, f))
      .filter(f => !f.startsWith(ALLOWED))
      .filter(f => /\.from\(\s*supporters\s*\)|from\s+supporters\b/i.test(readFileSync(join(ROOT, f), 'utf8')))
    expect(offenders).toEqual([])
  })
})
