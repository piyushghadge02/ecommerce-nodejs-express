<script setup>
/**
 * Generic loading skeleton. Pass Tailwind sizing classes via `cls`,
 * e.g. <Skeleton cls="h-40 w-full" />.
 */
defineProps({
  cls: { type: String, default: 'h-4 w-full' },
})
</script>

<template>
  <div class="animate-pulse rounded-lg bg-stone-200/70 dark:bg-stone-700/60" :class="cls" aria-hidden="true" />
</template>
