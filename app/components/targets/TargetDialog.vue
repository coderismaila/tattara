<script setup lang="ts">
import { targetSchema } from '~~/shared/schemas/targets'
import type { SetTargetResult } from '~~/shared/types/targets'
import { toUrlCode } from '~~/shared/utils/pu-code'

// Set one unit's target (task 6.4): the DG for a state, otherwise the lead of the unit above.
const props = defineProps<{
  code: string
  name: string
  current: number | null
}>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ saved: [result: SetTargetResult] }>()

const { t } = useI18n()
const toast = useToast()

const value = ref('')
const error = ref<string | null>(null)
const saving = ref(false)

watch(open, (isOpen) => {
  if (!isOpen) return
  value.value = props.current === null ? '' : String(props.current)
  error.value = null
}, { immediate: true })

async function save() {
  const parsed = targetSchema.safeParse({ target: value.value.trim() === '' ? undefined : value.value.trim() })
  if (!parsed.success) {
    error.value = parsed.error.issues[0]!.message
    return
  }
  saving.value = true
  error.value = null
  try {
    const url: string = `/api/targets/${toUrlCode(props.code)}`
    const result = await $fetch<SetTargetResult>(url, { method: 'PUT', body: parsed.data })
    toast.add({ title: t('targets.saved'), color: 'success', icon: 'i-lucide-check' })
    emit('saved', result)
    open.value = false
  }
  catch (e) {
    const status = (e as { statusCode?: number }).statusCode
    error.value = !status ? 'capture.errors.network' : status === 403 ? 'targets.errors.notAllowed' : status === 400 ? 'targets.errors.invalid' : 'capture.errors.unknown'
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="t('targets.dialogTitle', { name: props.name })"
  >
    <template #body>
      <form
        class="flex flex-col gap-4"
        novalidate
        @submit.prevent="save"
      >
        <UFormField
          :label="t('targets.label')"
          :help="t('targets.help')"
          name="target"
          size="xl"
        >
          <UInput
            v-model="value"
            type="text"
            inputmode="numeric"
            pattern="[0-9]*"
            autocomplete="off"
            class="w-full"
            size="xl"
            data-testid="target-input"
          />
        </UFormField>
        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          role="alert"
          :title="t(error)"
        />
        <UButton
          type="submit"
          size="xl"
          block
          class="min-h-12"
          :loading="saving"
          :label="t('targets.save')"
          data-testid="target-save"
        />
      </form>
    </template>
  </UModal>
</template>
