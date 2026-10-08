<script setup lang="ts">
// Review (tasks 5.3–5.4): ward leads get their call-backs and then the flags of their ward; LGA and state leads and
// the DG get the flags of their unit (supporters masked). Needs a connection.
definePageMeta({ layout: 'app', titleKey: 'nav.review' })

const { t } = useI18n()
const { user } = useUserSession()
const role = computed(() => user.value?.role)
const reviewer = computed(() => !!role.value && ['WARD_LEAD', 'LGA_LEAD', 'STATE_LEAD', 'DG'].includes(role.value))
</script>

<template>
  <div class="flex flex-col gap-8">
    <h1 class="text-2xl font-bold">
      {{ t('nav.review') }}
    </h1>

    <UAlert
      v-if="role && !reviewer"
      color="neutral"
      variant="subtle"
      :title="t('flag.notAllowed')"
    />
    <template v-else-if="reviewer">
      <ReviewCallbacks v-if="role === 'WARD_LEAD'" />
      <ReviewFlags />
    </template>
  </div>
</template>
