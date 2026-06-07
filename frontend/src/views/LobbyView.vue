<template>
  <div class="lobby-view">
    <!-- Loading state while checking lobby status -->
    <div v-if="loading" class="loading-message">
      <p>Loading lobby...</p>
    </div>

    <!-- Error state if lobby doesn't exist or can't be accessed -->
    <div v-else-if="error" class="error-message">
      <p>{{ error }}</p>
      <RouterLink to="/">Back to Home</RouterLink>
    </div>

    <!-- Show waiting lobby view if status is "waiting" -->
    <LobbyWaiting v-else-if="lobbyStatus === 'waiting'" />

    <!-- If status is "in-progress", GameView should handle it -->
    <!-- (This shouldn't normally happen - router should redirect to game view) -->
    <div v-else-if="lobbyStatus === 'in-progress'" class="redirect-message">
      <p>Game is in progress. Redirecting...</p>
    </div>

    <!-- If status is "concluded" -->
    <div v-else-if="lobbyStatus === 'concluded'" class="concluded-message">
      <p>This game has concluded.</p>
      <RouterLink to="/">Back to Home</RouterLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useLobbyStore } from '@/stores/lobby'
import LobbyWaiting from '@/components/LobbyWaiting.vue'

const router = useRouter()
const route = useRoute()
const lobbyStore = useLobbyStore()

const loading = ref(true)
const error = ref<string | null>(null)

const lobbyCode = route.params.code as string
const lobbyStatus = ref<'waiting' | 'in-progress' | 'concluded' | null>(null)

onMounted(async () => {
  try {
    // Restore lobby state from API (handles both initial join and page refresh)
    const status = await lobbyStore.restoreLobbyState(lobbyCode)
    
    if (!status) {
      error.value = 'Could not load lobby. The lobby may have been closed or does not exist.'
      loading.value = false
      return
    }

    // If the lobby is in-progress, redirect to game view
    if (status === 'in-progress') {
      loading.value = false
      await router.replace({ name: 'game', params: { code: lobbyCode } })
      return
    }

    // If concluded, show message (user can go back home)
    if (status === 'concluded') {
      lobbyStatus.value = status
      loading.value = false
      return
    }

    // Otherwise, show waiting view
    lobbyStatus.value = status
    loading.value = false
  } catch (err: any) {
    console.error('Error restoring lobby:', err)
    error.value = err.message || 'Failed to load lobby'
    loading.value = false
  }
})
</script>

<style scoped>
.lobby-view {
  min-height: 100vh;
  padding: 20px;
}

.loading-message,
.error-message,
.redirect-message,
.concluded-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  gap: 20px;
  text-align: center;
}

.error-message,
.redirect-message,
.concluded-message {
  color: #666;
  font-size: 18px;
}

a {
  display: inline-block;
  margin-top: 20px;
  padding: 10px 20px;
  background-color: #007bff;
  color: white;
  text-decoration: none;
  border-radius: 4px;
  transition: background-color 0.2s;
}

a:hover {
  background-color: #0056b3;
}
</style>
