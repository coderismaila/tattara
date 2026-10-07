<script setup lang="ts">
// The sync status pill (task 4.4, UX §2.3): where this phone's captures stand, as a link to the Sync screen. Shown to
// PU leads (the only ones with captures to send). Counts are live from the phone's database.
import { captureCounts } from '~/offline/outbox'
import { getLocalSession } from '~/offline/local-session'

const { t } = useI18n()
const { user } = useUserSession()
const online = useOnline()
const sync = useSync()
const counts = useLiveQuery(captureCounts, { pending: 0, rejected: 0 })

// Offline the session cookie can't be confirmed: the phone's own copy says who the lead is.
const localRole = ref<string | null>(null)
onMounted(async () => {
  localRole.value = (await getLocalSession().catch(() => undefined))?.role ?? null
})
const visible = computed(() => (user.value?.role ?? localRole.value) === 'PU_LEAD')

const view = computed(() => syncPillView({
  online: online.value,
  running: sync.state.value.running,
  pending: counts.value.pending,
  rejected: counts.value.rejected,
}))
const label = computed(() => t(`sync.pill.${view.value.key}`, { count: view.value.count }, view.value.count))
const toneClass = computed(() => ({
  neutral: 'border-default bg-default',
  success: 'border-neem-300 bg-neem-50',
  warning: 'border-amber-300 bg-amber-50',
}[view.value.tone]))
const iconClass = computed(() => ({ neutral: 'text-muted', success: 'text-success', warning: 'text-warning' }[view.value.tone]))
</script>

<template>
  <NuxtLink
    v-if="visible"
    to="/app/sync"
    class="flex min-h-12 shrink-0 items-center gap-2 rounded-full border px-3 text-sm font-medium text-highlighted focus-visible:outline-2 focus-visible:outline-primary"
    :class="toneClass"
    data-testid="sync-pill"
    :data-tone="view.tone"
  >
    <UIcon
      :name="view.icon"
      class="size-5 shrink-0"
      :class="[iconClass, { 'animate-spin motion-reduce:animate-none': view.key === 'sending' }]"
      aria-hidden="true"
    />
    <!-- Narrow phones: the count only; the full sentence stays available to screen readers. -->
    <span
      v-if="view.count > 0"
      class="sm:hidden"
      aria-hidden="true"
    >{{ view.count }}</span>
    <span
      class="max-sm:sr-only"
      data-testid="sync-pill-label"
    >{{ label }}</span>
  </NuxtLink>
</template>
