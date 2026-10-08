<script setup lang="ts">
// One call to make (task 5.3): who, where, a tap-to-call link, then the outcome and an optional note. Saving is final
// (the server refuses a second outcome), so the outcome is chosen first and confirmed with Save.
import type { CallbackOutcome } from '~~/shared/constants/enums'
import { callbackOutcomeSchema } from '~~/shared/schemas/callbacks'
import type { CallbackItem } from '~~/shared/types/callbacks'

const props = defineProps<{ item: CallbackItem, when: (iso: string) => string }>()
const emit = defineEmits<{ done: [] }>()

const { t } = useI18n()
const toast = useToast()

const outcome = ref<CallbackOutcome>()
const notes = ref('')
const saving = ref(false)
const error = ref<string | null>(null)

const outcomeItems = computed(() => (['verified', 'wrong_number', 'denies', 'unreachable'] as const)
  .map(value => ({ value, label: t(`callback.outcomes.${value}`) })))

async function save() {
  error.value = null
  const parsed = callbackOutcomeSchema.safeParse({ outcome: outcome.value, notes: notes.value })
  if (!parsed.success) {
    error.value = parsed.error.issues[0]!.message
    return
  }
  saving.value = true
  try {
    await $fetch(`/api/callbacks/${props.item.id}`, { method: 'POST', body: parsed.data })
    toast.add({ title: t('callback.saved'), color: 'success', icon: 'i-lucide-check' })
    emit('done')
  }
  catch (e) {
    const data = e as { statusCode?: number, data?: { data?: { reason?: string, issues?: { message: string }[] } } }
    const reason = data.data?.data?.reason
    error.value = reason === 'invalid' && data.data?.data?.issues?.[0]
      ? data.data.data.issues[0].message
      : reason === 'already_done' ? 'callback.errors.already_done' : data.statusCode ? 'callback.errors.unknown' : 'auth.errors.network'
    if (reason === 'already_done') emit('done')
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <li
    class="flex flex-col gap-3 rounded-lg border border-default bg-default p-4"
    data-testid="callback-item"
  >
    <div class="flex flex-col gap-1">
      <p class="text-lg font-semibold text-highlighted">
        {{ props.item.supporter.fullName }}
      </p>
      <p class="text-sm text-muted">
        {{ t('callback.meta', { pu: props.item.supporter.puCode, time: props.when(props.item.supporter.capturedAt) }) }}
      </p>
      <p
        v-if="props.item.overdue"
        class="text-sm font-medium text-highlighted"
      >
        <UIcon
          name="i-lucide-clock"
          class="me-1 size-4 align-[-2px] text-warning"
          aria-hidden="true"
        />{{ t('callback.overdue', { date: props.item.dueDate }) }}
      </p>
    </div>

    <UButton
      :to="`tel:${props.item.supporter.phone}`"
      external
      size="xl"
      color="neutral"
      variant="outline"
      class="min-h-12 self-start"
      icon="i-lucide-phone"
      :label="t('callback.call', { phone: props.item.supporter.phone })"
      data-testid="callback-call"
    />

    <SupporterChoiceGroup
      v-model="outcome"
      :legend="t('callback.outcomeLegend')"
      :items="outcomeItems"
      :disabled="saving"
      required
      data-testid="callback-outcome"
    />

    <UFormField
      :label="t('callback.notes')"
      :help="t('callback.notesHelp')"
      size="xl"
    >
      <UInput
        v-model="notes"
        class="w-full"
        size="xl"
        maxlength="200"
        autocomplete="off"
        :disabled="saving"
        data-testid="callback-notes"
      />
    </UFormField>

    <p
      v-if="error"
      role="alert"
      class="text-base text-highlighted"
      data-testid="callback-error"
    >
      <UIcon
        name="i-lucide-circle-alert"
        class="me-1 size-5 align-[-4px] text-error"
        aria-hidden="true"
      />{{ t(error) }}
    </p>

    <UButton
      size="xl"
      class="min-h-12 self-start"
      :label="t('callback.save')"
      :loading="saving"
      :disabled="!outcome"
      data-testid="callback-save"
      @click="save"
    />
  </li>
</template>
