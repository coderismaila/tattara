<script setup lang="ts">
// Any unit's dashboard (task 6.3, "Open dashboard" on the map): the 6.2 dashboard for a unit in the caller's scope.
// The stats routes enforce the scope; out-of-scope units show the load error.
import { fromUrlCode } from '~~/shared/utils/pu-code'

definePageMeta({ layout: 'app', titleKey: 'nav.map' })

const { t } = useI18n()
const route = useRoute()
const { data: me } = await useFetch('/api/auth/me', { key: 'me' })
const code = computed(() => fromUrlCode(String(route.params.code ?? '')))
const canReview = computed(() => !!me.value && ['WARD_LEAD', 'LGA_LEAD', 'STATE_LEAD', 'DG'].includes(me.value.user.role))
</script>

<template>
  <div class="flex flex-col gap-4">
    <UButton
      to="/app/map"
      color="neutral"
      variant="ghost"
      icon="i-lucide-arrow-left"
      class="min-h-12 self-start"
      :label="t('map.backToMap')"
    />
    <h1 class="sr-only">
      {{ t('map.unitDashboard') }}
    </h1>
    <LazyHomeUnitDashboard
      v-if="code !== null"
      :code="code"
      :can-review="canReview"
    />
    <UAlert
      v-else
      color="warning"
      variant="subtle"
      :title="t('dashboard.loadFailed')"
    />
  </div>
</template>
