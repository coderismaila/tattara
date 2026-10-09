// Usage: pnpm build && pnpm audit:runtime   (task 7.1, ADR-050; runs in CI after the build)
// Fails when a high or critical advisory affects a package that ships in the built server (.output/server/node_modules).
// Everything else `pnpm audit` reports (devtools, CLI, build plugins, data scripts) is listed as a warning: it never
// runs in production, and several advisories there have no fix yet. Client code is bundled from the same packages and
// is covered by the same check through their dependency paths.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

interface Advisory { module_name: string, severity: string, title: string, url: string, vulnerable_versions: string }

const ROOT = join(import.meta.dirname, '..')
const SHIPPED = join(ROOT, '.output/server/node_modules')
if (!existsSync(SHIPPED)) {
  console.error('No .output/server/node_modules: run `pnpm build` first.')
  process.exit(2)
}

/** Every package directory name under the shipped node_modules, scoped ones included. */
function shippedPackages(dir: string, out = new Set<string>()): Set<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    if (entry.name.startsWith('@')) {
      for (const sub of readdirSync(join(dir, entry.name), { withFileTypes: true })) {
        if (!sub.isDirectory()) continue
        out.add(`${entry.name}/${sub.name}`)
        const nested = join(dir, entry.name, sub.name, 'node_modules')
        if (existsSync(nested)) shippedPackages(nested, out)
      }
      continue
    }
    out.add(entry.name)
    const nested = join(dir, entry.name, 'node_modules')
    if (existsSync(nested)) shippedPackages(nested, out)
  }
  return out
}

let raw: string
try {
  raw = execFileSync('pnpm', ['audit', '--json'], { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024 })
}
catch (e) {
  // pnpm audit exits non-zero when it finds anything; the JSON is still on stdout.
  raw = (e as { stdout?: string }).stdout ?? ''
}
const advisories = Object.values((JSON.parse(raw) as { advisories?: Record<string, Advisory> }).advisories ?? {})
const serious = advisories.filter(a => a.severity === 'high' || a.severity === 'critical')
const shipped = shippedPackages(SHIPPED)

const failing = serious.filter(a => shipped.has(a.module_name))
const devOnly = advisories.filter(a => !shipped.has(a.module_name))

for (const a of devOnly) console.log(`warn (not shipped) ${a.severity.padEnd(8)} ${a.module_name}@${a.vulnerable_versions}: ${a.title}`)
for (const a of failing) console.error(`FAIL (ships)       ${a.severity.padEnd(8)} ${a.module_name}@${a.vulnerable_versions}: ${a.title} ${a.url}`)
console.log(`${advisories.length} advisories; ${failing.length} high/critical in shipped packages.`)
process.exit(failing.length ? 1 : 0)
