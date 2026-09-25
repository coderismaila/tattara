# UX Guidelines — Tattara

## 1. Who we design for
- **PU leads:** often first-time smartphone app users, Hausa-first, cheap Android, poor signal, bright sun, doing 30+ entries in a session while standing.
- **Ward/LGA leads:** mobile too; they supervise and review.
- **State/DG:** mobile and laptop; they read the map and tables.

## 2. Principles
1. **One job per screen.** Capture is a single scroll with a big Save button, no tabs, no modals.
2. **Hausa first, always switchable.** A language toggle sits in the header on every screen.
3. **Offline is normal, not an error.** Show a calm status pill: "An adana a waya · 12 na jiran aika" (Saved on phone · 12 waiting to send). Never a red banner just for being offline.
4. **Big and legible.** Base font 17 px, touch targets ≥ 48 px, high contrast for sunlight.
5. **Speed over completeness.** Only name, phone, support level and consent are required. Everything else is optional chips.
6. **Numbers the user can act on.** Every dashboard number answers "am I on track?" (value, target, and what's left).

## 3. Visual direction

The palette draws on Kano's Kofar Mata indigo dye pits and the laterite earth of the region: calm and serious,
not flashy campaign colours. **Swap `primary` for the party's brand colour in `app/app.config.ts`**; the
rest of the system should hold.

| Token | Hex | Use |
|---|---|---|
| `indigo-dye` | `#1F3A68` | primary actions, header |
| `laterite` | `#B5552B` | accents, "below target" |
| `millet` | `#E9D8A6` | highlight backgrounds, selected chips |
| `neem` | `#3F7D4E` | success, "synced", on-target |
| `harmattan` | `#F5F2EC` | app background (light) |
| `ink` | `#1A1A1A` | text |

- **Map ramp (coverage, colour-blind safe):** `#F1EEF6 → #BDC9E1 → #74A9CF → #2B8CBE → #045A8D`, with no-data hatched grey.
- **Type:** one family: **Noto Sans** (full Hausa hooked-letter support: ɓ ɗ ƙ ƴ). Numbers use tabular figures on dashboards.
- **Shape:** 12 px radius for inputs/buttons, 16 px for sheets; flat surfaces with borders rather than stacks of shadowed cards.
- **Motion:** only for confirmation (a "saved" check on submit) and map drill-down transitions. Respect `prefers-reduced-motion`.

Configure these as Nuxt UI theme colours (`app.config.ts` → `ui.colors`) plus CSS variables in `main.css`.

## 4. Key screens

### 4.1 Capture (PU lead) — `/app/capture`
```
┌───────────────────────────────┐
│ ‹  Ƙara magoyi baya    HA|EN  │
│ PU 19/05/03/012 · Kofar Gabas │  ← fixed, not editable
├───────────────────────────────┤
│ Suna *            [         ] │
│ Lambar waya *     [+234     ] │  ← numeric keypad; dup warning inline
│ Adireshi/alama    [         ] │
│ Jinsi      (Namiji)(Mace)     │  ← chips
│ Shekaru    (18-24)(25-34)…    │
│ Goyon baya * (Sosai)(Kaɗan)(Ba tabbas) │
│ PVC        (E)(A'a)(Ban sani)  │
│ ☐ Zai iya zama ɗan agaji      │
├───────────────────────────────┤
│ ▸ Karanta masa sanarwar izini │  ← expands consent script
│ ☐ Ya amince *                 │
├───────────────────────────────┤
│ [      Ajiye (Save)      ]    │  ← sticky bottom
│ ● An adana a waya · 3 jiran   │
└───────────────────────────────┘
```
After Save: a toast "An ajiye" / "Saved", the form clears, focus returns to Name, and the session counter goes up.
GPS is captured silently in the background; show a small pin icon with its accuracy, never block on it.

### 4.2 Home (role-aware) — `/app`
- **PU:** today's count, total vs target (progress ring), pending sync, "Add supporter" primary button.
- **Ward and above:** a unit summary card, a child-units table sorted by coverage (lowest first = where to act), "Inactive leads" and "Open flags" counts linking to the lists.

### 4.3 Map — `/app/map`
- Full-bleed map, a breadcrumb at the top (NW › Kano › Nassarawa LGA › Gama ward), a metric switcher, and a legend.
- Tapping a unit opens a bottom sheet with its key numbers and "Open dashboard" / "Zoom in".
- At ward level, PU points are sized by supporters and coloured by coverage.
- The desktop layout uses a side panel with a child-units table synced to the map hover.

### 4.4 Team — `/app/team`
A list of child units, each showing lead name/status (Active · Invited · None), last active and quality score. The "Invite" action opens a form with name and phone.

### 4.5 Sync — `/app/sync`
Pending, sent and rejected groups. Each rejected item states the reason in plain words and has a "Fix" link. Include a "Try sending now" button.

## 5. Copy rules
- Sentence case, plain verbs: "Add supporter", "Send now", "Invite lead".
- Errors say what happened and how to fix it: "This phone number is already used by 3 supporters. Check the number or mark it as a new one."
- Never "register voter" or anything suggesting INEC.
- All Hausa strings are reviewed by a native speaker before pilot; the mockups above are placeholders marked for review.

## 6. Accessibility
WCAG 2.2 AA contrast; visible focus rings; labels on every input (not placeholder-only); support screen readers (TalkBack) on capture.
