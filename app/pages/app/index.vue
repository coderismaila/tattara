<script setup lang="ts">
// Home (task 6.2, UX §4.2): PU leads get their PU at a glance (works offline); ward leads and above get their unit's
// dashboard (lazy-loaded); DG and admin the region. The registered-voters card (3.7) stays below.
import { getLocalSession, type LocalSession } from '~/offline/local-session'
import { TEAM_ROLES } from '~/utils/nav'
import { toUrlCode } from '~~/shared/utils/pu-code'

definePageMeta({ layout: 'app', titleKey: 'nav.home' })

const { t, n } = useI18n()

const { data: me } = await useFetch('/api/auth/me', { key: 'me' })
// Offline, /api/auth/me fails: the phone's own copy of the session (4.5) says who the lead is.
const local = ref<LocalSession | null>(null)
onMounted(async () => {
  local.value = (await getLocalSession().catch(() => undefined)) ?? null
})
const role = computed(() => me.value?.user.role ?? local.value?.role ?? null)
const isPuLead = computed(() => role.value === 'PU_LEAD')
const puCode = computed(() => me.value?.user.unitCode ?? local.value?.unitCode ?? null)
/** The caller's unit, `''` for region-wide roles (DG, admin). */
const scopeCode = computed(() => me.value?.scope.unitCode ?? null)
const canReview = computed(() => !!role.value && ['WARD_LEAD', 'LGA_LEAD', 'STATE_LEAD', 'DG'].includes(role.value))
/** Ward leads and above set the targets of the units below them (6.4); the page opens from here, not the nav bar. */
const canSetTargets = computed(() => !!role.value && TEAM_ROLES.includes(role.value))
const name = computed(() => me.value?.user.fullName ?? local.value?.fullName ?? '')

interface VotersSummary {
  code: string
  level: string
  registeredVoters: number | null
  reportedAt: string | null
  pusWithFigure: number
  totalPus: number
}
const votersUrl = computed(() => (scopeCode.value === null ? null : `/api/units/${toUrlCode(scopeCode.value)}/registered-voters`))
const { data: voters, refresh: refreshVoters } = await useFetch<VotersSummary>(() => votersUrl.value ?? '', {
  key: 'home-voters',
  immediate: votersUrl.value !== null,
})

// PU lead: ask once per device when the figure is missing (US-24); the card keeps offering it afterwards.
const PROMPT_KEY = 'tattara:votersPrompted'
const dialogOpen = ref(false)
onMounted(() => {
  if (!isPuLead.value || !voters.value || voters.value.registeredVoters !== null) return
  try {
    if (localStorage.getItem(`${PROMPT_KEY}:${voters.value.code}`)) return
    localStorage.setItem(`${PROMPT_KEY}:${voters.value.code}`, '1')
  }
  catch {
    // Storage blocked: prompt anyway (it only costs one tap to close).
  }
  dialogOpen.value = true
})
</script>

<template>
  <section class="flex flex-col gap-4">
    <h1 class="text-2xl font-bold">
      {{ name ? t('home.welcomeName', { name }) : t('home.welcome') }}
    </h1>

    <HomePuHome
      v-if="isPuLead && puCode"
      :pu-code="puCode"
    />
    <LazyHomeUnitDashboard
      v-else-if="scopeCode !== null && !isPuLead"
      :code="scopeCode"
      :can-review="canReview"
    />
    <UButton
      v-if="canSetTargets"
      to="/app/targets"
      variant="outline"
      icon="i-lucide-target"
      class="min-h-12 self-start"
      :label="t('targets.open')"
      data-testid="home-targets"
    />

    <div
      v-if="voters"
      class="flex flex-col gap-3 rounded-lg border p-4"
      :class="isPuLead && voters.registeredVoters === null ? 'border-warning bg-warning/10' : 'border-default bg-default'"
      data-testid="home-voters"
    >
      <h2 class="text-lg font-semibold">
        {{ t('units.voters.title') }}
      </h2>

      <template v-if="isPuLead">
        <p
          class="tabular text-3xl font-bold"
          data-testid="home-voters-value"
        >
          {{ voters.registeredVoters === null ? t('units.voters.notRecorded') : n(voters.registeredVoters) }}
        </p>
        <p class="text-muted">
          {{ t('units.voters.help') }}
        </p>
        <UButton
          class="min-h-12 self-start"
          :variant="voters.registeredVoters === null ? 'solid' : 'outline'"
          :label="t(voters.registeredVoters === null ? 'units.voters.record' : 'units.voters.update')"
          data-testid="home-voters-edit"
          @click="dialogOpen = true"
        />
        <UnitsVotersDialog
          v-model:open="dialogOpen"
          :pu-code="voters.code"
          :pu-name="me?.unit?.name ?? voters.code"
          :current="voters.registeredVoters"
          @saved="refreshVoters()"
        />
      </template>

      <template v-else>
        <p
          class="tabular text-3xl font-bold"
          data-testid="home-voters-value"
        >
          {{ voters.registeredVoters === null ? '—' : n(voters.registeredVoters) }}
        </p>
        <p
          class="text-muted"
          data-testid="home-voters-coverage"
        >
          {{ t('units.voters.coverage', { reported: n(voters.pusWithFigure), total: n(voters.totalPus) }) }}
        </p>
      </template>
    </div>
  </section>
</template>
