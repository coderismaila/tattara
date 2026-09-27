<script setup lang="ts" generic="T extends string">
// A row of large "chips" for one choice (UX §4.1): a real radio group, so arrow keys, Space and TalkBack work.
// The legend names the inner fieldset; aria-label names the radiogroup itself (ADR-029).
const props = defineProps<{
  legend: string
  items: { value: T, label: string }[]
  required?: boolean
  disabled?: boolean
}>()
const model = defineModel<T | undefined>()

// URadioGroup's types can't see through a generic wrapper: the values are exactly `items[].value`, so cast here.
const onUpdate = (value: unknown) => (model.value = value as T)
const radioValue = computed(() => model.value as string | undefined)
const radioItems = computed(() => props.items as { value: string, label: string }[])

const ui = {
  fieldset: 'flex flex-wrap gap-2',
  item: 'min-h-12 rounded-xl px-4 has-data-[state=checked]:bg-millet-500 has-data-[state=checked]:text-ink',
}
</script>

<template>
  <URadioGroup
    :model-value="radioValue"
    :legend="props.legend"
    :aria-label="props.legend"
    :items="radioItems"
    :required="props.required"
    :disabled="props.disabled"
    orientation="horizontal"
    variant="table"
    indicator="hidden"
    size="xl"
    :ui="ui"
    @update:model-value="onUpdate"
  />
</template>
