<script setup lang="ts">
// Activity (task 6.5, PRD US-14, ADR-049): a leaderboard of the units below (last 7 days by default) and the leads who
// need a nudge: active PU leads with no captures in N days, and leads invited but never set up. Lead names only, no
// phone numbers: each lead links to the Team list where calling and re-sending invites live. Online only.
import { TEAM_ROLES } from '~/utils/nav'
import type { UnitLevel } from '~~/shared/constants/enums'
import { LEADERBOARD_METRICS, LEADERBOARD_WINDOW_DAYS, type InactiveLeads, type Leaderboard, type LeaderboardMetric } from '~~/shared/types/stats'
import { parentCode, toUrlCode, unitLevel } from '~~/shared/utils/pu-code'

definePageMeta({ layout: 'app', titleKey: 'activity.title' })

const LEVELS: UnitLevel[] = ['state', 'lga', 'ward', 'pu']
const DAY_CHOICES = [3, 7, 14] as const

const { t, n, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const { data: me } = await useFetch('/api/auth/me', { key: 'me' })
const allowed = computed(() => !!me.value && TEAM_ROLES.includes(me.value.user.role))
/** The caller's unit, `''` for the DG's region. */
const code = computed(() => (allowed.value ? me.value?.scope.unitCode ?? null : null))
const url = computed(() => (code.value === null ? null : toUrlCode(code.value)))

const tab = computed<'top' | 'inactive'>({
  get: () => (route.query.tab === 'inactive' ? 'inactive' : 'top'),
  set: v => void router.replace({ query: { ...route.query, tab: v } }),
})

const ownDepth = computed(() => (code.value ? LEVELS.indexOf(unitLevel(code.value)!) + 1 : 0))
/** Levels below the caller's unit. */
const levels = computed(() => LEVELS.slice(ownDepth.value))
const level = ref<UnitLevel | null>(null)
const metric = ref<LeaderboardMetric>('recent')
const days = ref<number>(3)
watch(levels, l => (level.value = l[0] ?? null), { immediate: true })

const boardUrl = computed(() => (url.value && level.value ? `/api/stats/leaderboard/${url.value}?level=${level.value}&metric=${metric.value}&limit=20` : ''))
const inactiveUrl = computed(() => (url.value ? `/api/stats/inactive/${url.value}?days=${days.value}` : ''))
const { data: board, error: boardError, status: boardStatus } = await useFetch<Leaderboard>(boardUrl, { immediate: !!boardUrl.value })
const { data: inactive, error: inactiveError } = await useFetch<InactiveLeads>(inactiveUrl, { immediate: !!inactiveUrl.value })

const pct = (x: number | null) => (x === null ? '—' : n(x, { style: 'percent', maximumFractionDigits: 0 }))
function valueText(value: number | null): string {
  if (metric.value === 'recent') return t('activity.top.recentValue', { count: n(value ?? 0), days: LEADERBOARD_WINDOW_DAYS })
  return pct(value)
}
/** The Team list that holds this lead: the unit above theirs. */
const teamLink = (unitCode: string) => ({ path: '/app/team', query: { unit: toUrlCode(parentCode(unitCode) ?? '') } })
const dateFormat = computed(() => new Intl.DateTimeFormat(locale.value === 'ha' ? 'ha-NG' : 'en-NG', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Africa/Lagos',
}))
const lastSeen = (iso: string | null) => (iso ? t('team.lastActive', { when: dateFormat.value.format(new Date(iso)) }) : t('team.neverActive'))
</script>

<template>
  <section class="flex flex-col gap-6">
    <h1 class="text-2xl font-bold">
      {{ t('activity.title') }}
    </h1>

    <UAlert
      v-if="!allowed"
      color="warning"
      variant="subtle"
      :title="t('activity.notAllowed')"
    />

    <template v-else>
      <div
        class="flex flex-wrap gap-2"
        role="group"
        :aria-label="t('activity.tabsLabel')"
      >
        <UButton
          v-for="tb in (['top', 'inactive'] as const)"
          :key="tb"
          :color="tab === tb ? 'primary' : 'neutral'"
          :variant="tab === tb ? 'solid' : 'outline'"
          class="min-h-12"
          :aria-pressed="tab === tb"
          :label="t(`activity.tabs.${tb}`)"
          :data-testid="`activity-tab-${tb}`"
          @click="tab = tb"
        />
      </div>

      <!-- Leaderboard -->
      <section
        v-if="tab === 'top'"
        aria-labelledby="activity-top"
        class="flex flex-col gap-4"
      >
        <h2
          id="activity-top"
          class="text-lg font-semibold"
        >
          {{ t('activity.top.heading') }}
        </h2>
        <div
          v-if="levels.length > 1"
          class="flex flex-wrap gap-2"
          role="group"
          :aria-label="t('activity.top.levelLabel')"
        >
          <UButton
            v-for="l in levels"
            :key="l"
            :color="level === l ? 'primary' : 'neutral'"
            :variant="level === l ? 'solid' : 'outline'"
            class="min-h-12"
            :aria-pressed="level === l"
            :label="t(`activity.level.${l}`)"
            :data-testid="`activity-level-${l}`"
            @click="level = l"
          />
        </div>
        <div
          class="flex flex-wrap gap-2"
          role="group"
          :aria-label="t('activity.top.metricLabel')"
        >
          <UButton
            v-for="m in LEADERBOARD_METRICS"
            :key="m"
            :color="metric === m ? 'primary' : 'neutral'"
            :variant="metric === m ? 'solid' : 'outline'"
            class="min-h-12"
            :aria-pressed="metric === m"
            :label="t(`activity.metric.${m}`)"
            :data-testid="`activity-metric-${m}`"
            @click="metric = m"
          />
        </div>

        <UAlert
          v-if="boardError"
          color="warning"
          variant="subtle"
          icon="i-lucide-cloud-off"
          :title="t('dashboard.loadFailed')"
        />
        <p
          v-else-if="board && !board.rows.length"
          class="text-muted"
        >
          {{ t('activity.top.empty') }}
        </p>
        <template v-else-if="board">
          <p class="text-sm text-muted">
            {{ t('activity.top.showing', { shown: n(board.rows.length), total: n(board.total) }) }}
          </p>
          <ol
            class="flex flex-col gap-2"
            :aria-busy="boardStatus === 'pending'"
            data-testid="activity-board"
          >
            <li
              v-for="row in board.rows"
              :key="row.code"
              class="flex items-center gap-3 rounded-lg border border-default bg-default p-3"
              :data-testid="`activity-row-${row.code}`"
            >
              <span
                class="tabular grid size-10 shrink-0 place-items-center rounded-full bg-elevated font-bold"
                :aria-label="t('activity.top.rank', { rank: row.rank })"
              >{{ row.rank }}</span>
              <div class="min-w-0 flex-1">
                <p class="font-medium">
                  {{ row.name }}
                  <span class="tabular block text-sm font-normal text-muted">{{ row.code }}</span>
                </p>
              </div>
              <p
                class="tabular text-right font-semibold"
                data-testid="activity-row-value"
              >
                {{ valueText(row.value) }}
              </p>
            </li>
          </ol>
        </template>
      </section>

      <!-- Inactive leads -->
      <section
        v-else
        aria-labelledby="activity-inactive"
        class="flex flex-col gap-4"
      >
        <h2
          id="activity-inactive"
          class="text-lg font-semibold"
        >
          {{ t('activity.inactive.heading') }}
        </h2>
        <div
          class="flex flex-wrap gap-2"
          role="group"
          :aria-label="t('activity.inactive.daysLabel')"
        >
          <UButton
            v-for="dc in DAY_CHOICES"
            :key="dc"
            :color="days === dc ? 'primary' : 'neutral'"
            :variant="days === dc ? 'solid' : 'outline'"
            class="min-h-12"
            :aria-pressed="days === dc"
            :label="t('activity.inactive.days', { days: dc })"
            :data-testid="`activity-days-${dc}`"
            @click="days = dc"
          />
        </div>

        <UAlert
          v-if="inactiveError"
          color="warning"
          variant="subtle"
          icon="i-lucide-cloud-off"
          :title="t('dashboard.loadFailed')"
        />
        <template v-else-if="inactive">
          <p
            v-if="!inactive.inactive.length"
            class="text-muted"
            data-testid="activity-inactive-empty"
          >
            {{ t('activity.inactive.none', { days: inactive.days }) }}
          </p>
          <ul
            v-else
            class="flex flex-col gap-2"
            data-testid="activity-inactive"
          >
            <li
              v-for="lead in inactive.inactive"
              :key="lead.userId"
              class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-default bg-default p-3"
              :data-testid="`activity-lead-${lead.unitCode}`"
            >
              <div class="min-w-0">
                <p class="font-medium">
                  {{ lead.name }}
                </p>
                <p class="text-sm text-muted">
                  {{ lead.unitName }} · <span class="tabular">{{ lead.unitCode }}</span>
                </p>
                <p>
                  {{ lead.lastCaptureAt === null
                    ? t('activity.inactive.neverCaptured', { days: n(lead.daysInactive) })
                    : t('activity.inactive.noCaptures', { days: n(lead.daysInactive) }) }}
                </p>
                <p class="text-sm text-muted">
                  {{ lastSeen(lead.lastSeenAt) }}
                </p>
              </div>
              <UButton
                :to="teamLink(lead.unitCode)"
                variant="outline"
                class="min-h-12"
                icon="i-lucide-users"
                :label="t('activity.openTeam')"
                :aria-label="t('activity.openTeamFor', { name: lead.name })"
              />
            </li>
          </ul>
          <p
            v-if="inactive.inactiveTotal > inactive.inactive.length"
            class="text-sm text-muted"
          >
            {{ t('activity.more', { shown: n(inactive.inactive.length), total: n(inactive.inactiveTotal) }) }}
          </p>

          <h2
            id="activity-not-started"
            class="text-lg font-semibold"
          >
            {{ t('activity.notStarted.heading') }}
          </h2>
          <p
            v-if="!inactive.notStarted.length"
            class="text-muted"
          >
            {{ t('activity.notStarted.none') }}
          </p>
          <ul
            v-else
            class="flex flex-col gap-2"
            aria-labelledby="activity-not-started"
            data-testid="activity-not-started"
          >
            <li
              v-for="lead in inactive.notStarted"
              :key="lead.userId"
              class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-default bg-default p-3"
              :data-testid="`activity-invited-${lead.unitCode}`"
            >
              <div class="min-w-0">
                <p class="font-medium">
                  {{ lead.name }}
                  <span class="block text-sm font-normal text-muted">{{ t(`activity.role.${lead.role}`) }}</span>
                </p>
                <p class="text-sm text-muted">
                  {{ lead.unitName }} · <span class="tabular">{{ lead.unitCode }}</span>
                </p>
                <p>{{ t('activity.notStarted.invited', { days: n(lead.daysSinceInvite) }) }}</p>
              </div>
              <UButton
                :to="teamLink(lead.unitCode)"
                variant="outline"
                class="min-h-12"
                icon="i-lucide-users"
                :label="t('activity.openTeam')"
                :aria-label="t('activity.openTeamFor', { name: lead.name })"
              />
            </li>
          </ul>
          <p
            v-if="inactive.notStartedTotal > inactive.notStarted.length"
            class="text-sm text-muted"
          >
            {{ t('activity.more', { shown: n(inactive.notStarted.length), total: n(inactive.notStartedTotal) }) }}
          </p>
        </template>
      </section>
    </template>
  </section>
</template>
