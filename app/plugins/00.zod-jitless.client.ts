// Zod 4 probes `new Function('')` the first time it builds an object schema, to decide whether to compile parsers. Under
// our strict CSP (no 'unsafe-eval', task 7.1, ADR-050) the probe fails harmlessly but is still reported as a CSP
// violation, so turn the compiler off in the browser. The server keeps it (no CSP applies there).
// The core `config` only (not the whole of zod): this file is in every page's entry chunk.
import { config } from 'zod/v4/core'

// At module level, not in setup(): the router plugin loads the first page (whose schemas are built on import) before
// app plugins run, while plugin modules themselves are evaluated as the entry loads, before any of that.
config({ jitless: true })

export default defineNuxtPlugin({ name: 'tattara:zod-jitless' })
