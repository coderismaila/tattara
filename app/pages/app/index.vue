<script setup lang="ts">
import { toUrlCode } from '~~/shared/utils/pu-code'

definePageMeta({ layout: 'app', titleKey: 'nav.home' })

const { t, n } = useI18n()

const { data: me } = await useFetch('/api/auth/me', { key: 'me' })
const isPuLead = computed(() => me.value?.user.role === 'PU_LEAD')
/** The caller's unit, `''` for region-wide roles (DG, admin). */
const scopeCode = computed(() => me.value?.scope.unitCode ?? null)

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
    <div class="flex flex-col gap-2">
      <h1 class="text-2xl font-bold">
        {{ t('home.welcome') }}
      </h1>
      <!-- Role-aware home arrives in 6.2. -->
      <p class="text-muted">
        {{ t('home.placeholder') }}
      </p>
    </div>

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
