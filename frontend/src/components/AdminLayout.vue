<script setup>
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import { LayoutDashboard, Menu, Package, Store, X } from 'lucide-vue-next'

const route = useRoute()
const mobileOpen = ref(false)

const nav = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/admin/catalog', label: 'Catalog', icon: Package, exact: false },
]

function isActive(item) {
  return item.exact ? route.path === item.to : route.path.startsWith(item.to)
}

const linkCls = (active) =>
  [
    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-soft',
    active ? 'bg-indigo-50 text-indigo-700' : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900',
  ].join(' ')
</script>

<template>
  <div class="min-h-screen bg-stone-50">
    <!-- Mobile top bar -->
    <header class="sticky top-0 z-30 flex items-center gap-3 border-b border-stone-200 bg-white px-4 py-3 lg:hidden">
      <button
        class="rounded-lg p-2 text-stone-600 transition-soft hover:bg-stone-100"
        aria-label="Open admin menu"
        @click="mobileOpen = true"
      >
        <Menu class="h-5 w-5" />
      </button>
      <div class="flex items-center gap-2">
        <div class="rounded-lg bg-indigo-600 p-1.5">
          <Package class="h-4 w-4 text-white" aria-hidden="true" />
        </div>
        <span class="text-sm font-bold text-stone-900">Admin Console</span>
      </div>
    </header>

    <!-- Desktop sidebar -->
    <aside class="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-stone-200 bg-white lg:flex">
      <div class="flex items-center gap-2.5 border-b border-stone-200 px-5 py-4">
        <div class="rounded-lg bg-indigo-600 p-2">
          <Package class="h-5 w-5 text-white" aria-hidden="true" />
        </div>
        <div>
          <p class="text-sm font-bold text-stone-900">Polyglot Commerce</p>
          <p class="text-xs text-stone-500">Admin Console</p>
        </div>
      </div>

      <nav class="flex-1 space-y-1 p-4" aria-label="Admin">
        <router-link v-for="item in nav" :key="item.to" :to="item.to" :class="linkCls(isActive(item))">
          <component :is="item.icon" class="h-5 w-5" aria-hidden="true" />
          {{ item.label }}
        </router-link>
      </nav>

      <div class="border-t border-stone-200 p-4">
        <router-link
          to="/"
          class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-stone-600 transition-soft hover:bg-stone-100 hover:text-stone-900"
        >
          <Store class="h-5 w-5" aria-hidden="true" />
          Storefront
        </router-link>
        <p class="mt-3 px-3 text-[11px] leading-relaxed text-stone-400">
          Demo POC — orders write to PostgreSQL, catalog to MongoDB, search reads Elasticsearch.
        </p>
      </div>
    </aside>

    <!-- Mobile drawer -->
    <div v-if="mobileOpen" class="fixed inset-0 z-40 lg:hidden">
      <div class="absolute inset-0 bg-stone-900/40" @click="mobileOpen = false"></div>
      <aside class="absolute inset-y-0 left-0 flex w-72 flex-col bg-white shadow-2xl">
        <div class="flex items-center justify-between border-b border-stone-200 px-5 py-4">
          <p class="text-sm font-bold text-stone-900">Admin Console</p>
          <button
            class="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100"
            aria-label="Close admin menu"
            @click="mobileOpen = false"
          >
            <X class="h-5 w-5" />
          </button>
        </div>
        <nav class="flex-1 space-y-1 p-4" aria-label="Admin">
          <router-link
            v-for="item in nav"
            :key="item.to"
            :to="item.to"
            :class="linkCls(isActive(item))"
            @click="mobileOpen = false"
          >
            <component :is="item.icon" class="h-5 w-5" aria-hidden="true" />
            {{ item.label }}
          </router-link>
        </nav>
        <div class="border-t border-stone-200 p-4">
          <router-link
            to="/"
            class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-stone-600 hover:bg-stone-100"
            @click="mobileOpen = false"
          >
            <Store class="h-5 w-5" aria-hidden="true" />
            Storefront
          </router-link>
        </div>
      </aside>
    </div>

    <!-- Content -->
    <div class="lg:pl-64">
      <main class="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
        <slot />
      </main>
    </div>
  </div>
</template>
