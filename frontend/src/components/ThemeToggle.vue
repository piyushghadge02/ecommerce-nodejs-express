<script setup>
import { Moon, Sun } from 'lucide-vue-next'
import { isDark, toggleTheme } from '../stores/theme.js'

/**
 * Global dark-mode toggle. Every instance controls the same theme store,
 * so switching on any page updates the whole application instantly.
 * Extra classes (e.g. `ml-auto`) fall through to the button.
 */
</script>

<template>
  <button
    type="button"
    class="inline-flex items-center rounded-lg border border-stone-200 bg-white p-2 text-stone-600 transition-soft hover:bg-stone-50 hover:text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100"
    :aria-label="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
    :title="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
    @click="toggleTheme"
  >
    <Moon v-if="!isDark" class="h-4 w-4" aria-hidden="true" />
    <Sun v-else class="h-4 w-4" aria-hidden="true" />
  </button>
</template>
