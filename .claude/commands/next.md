Continue building Tattara.

1. Read CLAUDE.md, then docs/PROGRESS.md (blockers first), then find the first unchecked task in docs/IMPLEMENTATION_PLAN.md. If it is marked 👤, stop and tell me what you need from me.
2. Re-read the doc sections that task depends on (ARCHITECTURE, DATA_MODEL, API, SECURITY_PRIVACY, UX_GUIDELINES).
3. Before using any Nuxt, Nuxt UI or module API you're not certain about for Nuxt 4.5 / compat 5, check the docs MCP servers or the official docs.
4. Show me a short plan (files to create/change, tests to write). Wait for my OK unless I said "go".
5. Implement with tests. Run `pnpm lint && pnpm typecheck && pnpm test` (and e2e if the task lists it) until green.
6. Tick the task, add a line to PROGRESS.md, record any decisions in DECISIONS.md, and commit with a Conventional Commit message.
7. Tell me in 3–5 lines what was done and what's next.

$ARGUMENTS
