// Security headers on every response and the hashed page CSP in every rendered page (task 7.1, ADR-050). Pure rules in
// server/utils/security-headers.ts. In development Vite injects its own inline client and HMR, so no page CSP there.
import { setResponseHeaders } from 'h3'
import { defineNitroPlugin } from 'nitropack/runtime'
import { SECURITY_HEADERS, inlineScriptHashes, pageCsp, withCspMeta } from '../utils/security-headers.ts'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    setResponseHeaders(event, SECURITY_HEADERS)
  })

  // Runs for server renders, the /app SPA shell and prerendering (the landing page), so the CSP is in all of them.
  nitroApp.hooks.hook('render:html', (html, { streaming }) => {
    if (import.meta.dev || streaming) return
    const page = [...html.head, ...html.bodyPrepend, ...html.body, ...html.bodyAppend].join('')
    html.head = withCspMeta(html.head, pageCsp(inlineScriptHashes(page)))
  })

  nitroApp.hooks.hook('render:response', (response) => {
    if (response?.headers) delete response.headers['x-powered-by']
  })
})
