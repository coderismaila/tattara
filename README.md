# Tattara

Offline-first PWA for building a consented supporter registry across North West Nigeria,
organised by INEC State → LGA → Ward → Polling Unit. Built with Nuxt 4.5 (compat v5), Nuxt UI v4,
Postgres/PostGIS and Claude Code.

## Getting started with Claude Code

Prerequisites: Node 24 LTS, pnpm, Docker, Git, Claude Code.

```bash
# 1. put these files in a new folder and init git
cd tattara
git init && git add . && git commit -m "docs: project blueprint"

# 2. start the database
docker compose up -d db
cp .env.example .env        # fill NUXT_SESSION_PASSWORD (32+ chars)

# 3. open Claude Code in the folder
claude
```

Inside Claude Code:

- `/next` builds the next task in docs/IMPLEMENTATION_PLAN.md (plan → your OK → build → test → commit).
- `/security-review` checks current changes against docs/SECURITY_PRIVACY.md.
- `/verify-nuxt` checks versions, advisories and compat-5 escape hatches.

Suggested first message: `/next go — start with task 0.1`

## Docs
| File | Purpose |
|---|---|
| CLAUDE.md | Rules Claude Code follows in every session |
| docs/PRD.md | Product scope, roles, requirements |
| docs/IMPLEMENTATION_PLAN.md | Ordered tasks with acceptance criteria |
| docs/ARCHITECTURE.md | Stack, structure, offline sync, auth, maps |
| docs/DATA_MODEL.md | Database and IndexedDB schema |
| docs/API.md | Server routes |
| docs/SECURITY_PRIVACY.md | Access matrix, masking, consent, NDPA |
| docs/UX_GUIDELINES.md | Screens, palette, Hausa/English copy rules |
| docs/SEED_DATA.md | Importing INEC polling units and boundaries |
| docs/DECISIONS.md | Decision log |
| docs/PROGRESS.md | Running log Claude updates after each task |
