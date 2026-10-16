<script setup>
const props = defineProps({
  title: { type: String, required: true },
  value: { type: [String, Number], required: true },
  icon: { type: [Object, Function], required: true },
  /** Tailwind classes for the icon chip, e.g. 'bg-indigo-100 text-indigo-600' */
  accent: { type: String, default: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400' },
  sub: { type: String, default: '' },
})
</script>

<template>
  <div class="rounded-xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5 dark:border-stone-800 dark:bg-stone-900">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="text-xs font-medium tracking-wide text-stone-500 uppercase dark:text-stone-400">{{ title }}</p>
        <p class="mt-1 truncate text-2xl font-bold text-stone-900 tabular-nums dark:text-stone-100">{{ value }}</p>
        <p v-if="sub" class="mt-1 text-xs text-stone-500 dark:text-stone-400">{{ sub }}</p>
      </div>
      <div class="shrink-0 rounded-lg p-2.5" :class="accent">
        <component :is="icon" class="h-5 w-5" aria-hidden="true" />
      </div>
    </div>
  </div>
</template>
