<script setup lang="ts">
import { registeredVotersSchema } from '~~/shared/schemas/units'
import { toUrlCode } from '~~/shared/utils/pu-code'

// Record or correct a PU's registered-voter figure (US-24). Used by Home (PU lead) and Team (ward lead).
const props = defineProps<{
  puCode: string
  puName: string
  current: number | null
}>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ saved: [registeredVoters: number] }>()

const { t } = useI18n()
const toast = useToast()

const value = ref('')
const error = ref<string | null>(null)
const saving = ref(false)

// `immediate`: the Team page mounts the dialog already open.
watch(open, (isOpen) => {
  if (!isOpen) return
  value.value = props.current === null ? '' : String(props.current)
  error.value = null
}, { immediate: true })

async function save() {
  const parsed = registeredVotersSchema.safeParse({ registeredVoters: value.value.trim() === '' ? undefined : value.value.trim() })
  if (!parsed.success) {
    error.value = parsed.error.issues[0]!.message
    return
  }
  saving.value = true
  error.value = null
  try {
    const url: string = `/api/units/${toUrlCode(props.puCode)}/registered-voters`
    await $fetch(url, { method: 'PUT', body: parsed.data })
    toast.add({ title: t('units.voters.saved'), color: 'success', icon: 'i-lucide-check' })
    emit('saved', parsed.data.registeredVoters)
    open.value = false
  }
  catch (e) {
    const status = (e as { statusCode?: number }).statusCode
    error.value = !status ? 'capture.errors.network' : status === 403 ? 'units.errors.notAllowed' : status === 400 ? 'units.errors.votersInvalid' : 'capture.errors.unknown'
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="t('units.voters.dialogTitle', { name: props.puName })"
  >
    <template #body>
      <form
        class="flex flex-col gap-4"
        novalidate
        @submit.prevent="save"
      >
        <p>{{ t('units.voters.dialogIntro') }}</p>
        <UFormField
          :label="t('units.voters.label')"
          :help="t('units.voters.help')"
          name="registeredVoters"
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
            data-testid="voters-input"
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
          :label="t('units.voters.save')"
          data-testid="voters-save"
        />
      </form>
    </template>
  </UModal>
</template>
