// Task 3.6 AC: any route without an access-matrix entry fails CI (and so does an entry for a route that's gone).
import { readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CALLERS } from '../e2e/access/callers'
import { ACCESS_MATRIX } from '../e2e/access/matrix'

const API_DIR = join(import.meta.dirname, '../../server/api')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

/** `server/api/team/[userId]/deactivate.post.ts` → `POST /api/team/:userId/deactivate`. */
export function routeKey(file: string): string {
  const rel = relative(API_DIR, file).split(sep).join('/')
  const match = /^(.*?)(?:\.(get|post|put|patch|delete))?\.ts$/.exec(rel)
  if (!match) throw new Error(`Unexpected route file: ${rel}`)
  const method = (match[2] ?? 'get').toUpperCase()
  const path = `/api/${match[1]}`
    .replace(/\/index$/, '')
    .replace(/\[\.\.\.(\w+)\]/g, ':$1*')
    .replace(/\[(\w+)\]/g, ':$1')
  return `${method} ${path}`
}

describe('access matrix', () => {
  const routes = files(API_DIR).filter(f => f.endsWith('.ts')).map(routeKey).sort()

  it('names routes the way the matrix does', () => {
    expect(routeKey(join(API_DIR, 'team/[userId]/deactivate.post.ts'))).toBe('POST /api/team/:userId/deactivate')
    expect(routeKey(join(API_DIR, 'supporters/index.get.ts'))).toBe('GET /api/supporters')
    expect(routeKey(join(API_DIR, 'supporters/[id].patch.ts'))).toBe('PATCH /api/supporters/:id')
  })

  it('has an entry for every route under server/api, and nothing else', () => {
    expect(Object.keys(ACCESS_MATRIX).sort()).toEqual(routes)
  })

  it('states an expected status for every caller on every route', () => {
    for (const [route, entry] of Object.entries(ACCESS_MATRIX)) {
      expect(Object.keys(entry.expect).sort(), route).toEqual([...CALLERS].sort())
    }
  })

  it('never lets a signed-out caller into a non-public route', () => {
    const PUBLIC = ['POST /api/auth/login', 'POST /api/auth/otp/verify', 'POST /api/auth/otp/resend', 'POST /api/auth/setup', 'POST /api/auth/logout']
    for (const [route, entry] of Object.entries(ACCESS_MATRIX)) {
      if (!PUBLIC.includes(route)) expect(entry.expect.anon, route).toBe(401)
    }
  })
})
