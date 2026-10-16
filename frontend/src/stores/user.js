import { computed, reactive } from 'vue'
import { apiError, usersApi } from '../api/client.js'

/**
 * Demo-user store. There is no authentication in this POC — the shopper
 * simply picks one of the 8 seeded PostgreSQL users from the "Log In As"
 * dropdown. The selection is persisted locally.
 */
const STORAGE_KEY = 'poc-user-id'

export const userStore = reactive({
  users: [],
  selectedId: null,
  loading: false,
  error: null,
})

export const selectedUser = computed(() =>
  userStore.users.find((u) => String(u.id) === String(userStore.selectedId)) ?? null,
)

export function selectUser(id) {
  userStore.selectedId = id == null ? null : Number(id)
  try {
    if (userStore.selectedId == null) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, String(userStore.selectedId))
  } catch {
    /* ignore */
  }
}

export async function loadUsers() {
  if (userStore.users.length > 0 || userStore.loading) return
  userStore.loading = true
  userStore.error = null
  try {
    const { data } = await usersApi.list()
    userStore.users = Array.isArray(data) ? data : []
    let saved = null
    try {
      saved = localStorage.getItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
    const exists = userStore.users.some((u) => String(u.id) === String(saved))
    selectUser(exists ? saved : (userStore.users[0]?.id ?? null))
  } catch (err) {
    userStore.error = apiError(err, 'Could not load demo users')
  } finally {
    userStore.loading = false
  }
}
