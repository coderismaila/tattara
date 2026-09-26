<script setup lang="ts">
const { t } = useI18n()
const route = useRoute()

const { user } = useUserSession()

const title = computed(() => t(route.meta.titleKey ?? 'app.name'))
const items = computed(() => navItemsFor(user.value?.role).map(item => ({
  ...item,
  active: isNavItemActive(item, route.path),
})))

useHead({ title })
</script>

<template>
  <div class="flex min-h-dvh flex-col">
    <a
      href="#main"
      class="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-default focus:p-3"
    >{{ t('a11y.skipToContent') }}</a>

    <header class="sticky top-0 z-20 border-b-4 border-primary bg-default">
      <div class="mx-auto flex h-16 w-full max-w-5xl items-center gap-4 px-4">
        <span class="truncate text-lg font-bold text-primary">{{ title }}</span>

        <!-- Desktop / tablet navigation -->
        <nav
          class="hidden md:block"
          :aria-label="t('nav.label')"
        >
          <ul class="flex gap-1">
            <li
              v-for="item in items"
              :key="item.to"
            >
              <NuxtLink
                :to="item.to"
                :aria-current="item.active ? 'page' : undefined"
                class="flex min-h-12 items-center gap-2 rounded-md px-3 font-medium focus-visible:outline-2 focus-visible:outline-primary"
                :class="item.active ? 'bg-millet-500 text-ink' : 'text-toned hover:bg-elevated'"
              >
                <UIcon
                  :name="item.icon"
                  class="size-5"
                  aria-hidden="true"
                />
                {{ t(item.labelKey) }}
              </NuxtLink>
            </li>
          </ul>
        </nav>

        <CommonLanguageSwitch class="ms-auto" />
      </div>
    </header>

    <main
      id="main"
      class="mx-auto w-full max-w-5xl flex-1 px-4 pt-4 pb-28 md:pb-8"
    >
      <slot />
    </main>

    <!-- Mobile bottom navigation -->
    <nav
      class="fixed inset-x-0 bottom-0 z-20 border-t border-default bg-default pb-[env(safe-area-inset-bottom)] md:hidden"
      :aria-label="t('nav.label')"
    >
      <ul
        class="grid"
        :style="{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }"
      >
        <li
          v-for="item in items"
          :key="item.to"
        >
          <NuxtLink
            :to="item.to"
            :aria-current="item.active ? 'page' : undefined"
            class="flex min-h-16 flex-col items-center justify-center gap-1 text-sm font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
            :class="item.active ? 'bg-millet-500 text-ink' : 'text-toned'"
          >
            <UIcon
              :name="item.icon"
              class="size-6"
              aria-hidden="true"
            />
            {{ t(item.labelKey) }}
          </NuxtLink>
        </li>
      </ul>
    </nav>
  </div>
</template>
