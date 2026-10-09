<script setup lang="ts">
import type { DistributeResult } from '~~/shared/types/targets'
import { toUrlCode } from '~~/shared/utils/pu-code'

// Split the lead's own target across the units below (task 6.4): a preview first, then save. Weighted by registered
// voters, or by PU count where figures are missing (the dialog says which).
const props = defineProps<{ code: string }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ saved: [result: DistributeResult] }>()

const { t, n } = useI18n()
const toast = useToast()

const preview = ref<DistributeResult | null>(null)
const error = ref<string | null>(null)
const loading = ref(false)
const saving = ref(false)

const url = computed(() => `/api/targets/${toUrlCode(props.code)}/distribute`)

function errorKey(e: unknown): string {
  const status = (e as { statusCode?: number }).statusCode
  const reason = (e as { data?: { data?: { reason?: string } } }).data?.data?.reason
  if (!status) return 'capture.errors.network'
  if (status === 409) return reason === 'no_children' ? 'targets.errors.noChildren' : 'targets.errors.noTarget'
  return status === 403 ? 'targets.errors.notAllowed' : 'capture.errors.unknown'
}

watch(open, async (isOpen) => {
  if (!isOpen) return
  preview.value = null
  error.value = null
  loading.value = true
  try {
    preview.value = await $fetch<DistributeResult>(url.value, { method: 'POST', body: { method: 'proportional', preview: true } })
  }
  catch (e) {
    error.value = errorKey(e)
  }
  finally {
    loading.value = false
  }
}, { immediate: true })

async function save() {
  saving.value = true
  error.value = null
  try {
    const result = await $fetch<DistributeResult>(url.value, { method: 'POST', body: { method: 'proportional' } })
    toast.add({ title: t('targets.split.saved'), color: 'success', icon: 'i-lucide-check' })
    emit('saved', result)
    open.value = false
  }
  catch (e) {
    error.value = errorKey(e)
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="t('targets.split.title')"
  >
    <template #body>
      <div class="flex flex-col gap-4">
        <p
          v-if="loading"
          role="status"
        >
          {{ t('targets.split.loading') }}
        </p>
        <template v-if="preview">
          <p data-testid="split-basis">
            {{ t(preview.basis === 'registered_voters' ? 'targets.split.byVoters' : 'targets.split.byPus', { target: n(preview.target) }) }}
          </p>
          <table class="w-full text-left">
            <caption class="sr-only">
              {{ t('targets.split.caption') }}
            </caption>
            <thead>
              <tr class="text-sm text-muted">
                <th
                  scope="col"
                  class="py-1 pr-2 font-medium"
                >
                  {{ t('dashboard.col.unit') }}
                </th>
                <th
                  scope="col"
                  class="py-1 pr-2 text-right font-medium"
                >
                  {{ t('targets.split.before') }}
                </th>
                <th
                  scope="col"
                  class="py-1 text-right font-medium"
                >
                  {{ t('targets.split.after') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in preview.children"
                :key="row.code"
                class="border-t border-default"
                :data-testid="`split-row-${row.code}`"
              >
                <th
                  scope="row"
                  class="py-2 pr-2 font-medium"
                >
                  {{ row.name }}
                </th>
                <td class="tabular py-2 pr-2 text-right text-muted">
                  {{ row.previous === null ? '—' : n(row.previous) }}
                </td>
                <td class="tabular py-2 text-right font-semibold">
                  {{ n(row.target) }}
                </td>
              </tr>
            </tbody>
          </table>
        </template>
        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          role="alert"
          :title="t(error)"
        />
        <UButton
          v-if="preview"
          size="xl"
          block
          class="min-h-12"
          :loading="saving"
          :label="t('targets.split.confirm')"
          data-testid="split-confirm"
          @click="save"
        />
      </div>
    </template>
  </UModal>
</template>
