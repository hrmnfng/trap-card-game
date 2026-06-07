<template>
  <div class="game-view">
    <!-- Loading state while checking game status -->
    <div v-if="loading" class="loading-message">
      <p>Loading game...</p>
    </div>

    <!-- Error state if game can't be accessed -->
    <div v-else-if="error" class="error-message">
      <p>{{ error }}</p>
      <RouterLink to="/">Back to Home</RouterLink>
    </div>

    <!-- Show game board if status is "in-progress" -->
    <GameBoard v-else-if="gameStatus === 'in-progress'" />

    <!-- If status is "waiting", redirect back to lobby -->
    <div v-else-if="gameStatus === 'waiting'" class="redirect-message">
      <p>Game hasn't started yet. Redirecting to lobby...</p>
    </div>

    <!-- If status is "concluded" -->
    <div v-else-if="gameStatus === 'concluded'" class="concluded-message">
      <p>This game has concluded.</p>
      <RouterLink to="/">Back to Home</RouterLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useLobbyStore } from '@/stores/lobby'
import GameBoard from '@/components/GameBoard.vue'

const router = useRouter()
const route = useRoute()
const lobbyStore = useLobbyStore()

const loading = ref(true)
const error = ref<string | null>(null)

const lobbyCode = route.params.code as string
const gameStatus = ref<'waiting' | 'in-progress' | 'concluded' | null>(null)

onMounted(async () => {
  try {
    console.log('[GameView] Mounting, restoring lobby state for code:', lobbyCode)
    
    // Restore lobby/game state from API
    // skipRedirect=false to use normal auto-redirect logic
    const status = await lobbyStore.restoreLobbyState(lobbyCode, false)
    
    console.log('[GameView] Restored status:', status, 'Type:', typeof status)
    
    if (!status) {
      error.value = 'Could not load game. The lobby may have been closed or does not exist.'
      loading.value = false
      return
    }

    // If the game hasn't started yet, redirect to lobby view
    if (status === 'waiting') {
      console.log('[GameView] Status is waiting, redirecting to lobby')
      loading.value = false
      await router.replace({ name: 'lobby', params: { code: lobbyCode } })
      return
    }

    // If concluded, show message (user can go back home)
    if (status === 'concluded') {
      console.log('[GameView] Status is concluded')
      gameStatus.value = status
      loading.value = false
      return
    }

    // Otherwise, show game board
    console.log('[GameView] Status is in-progress, showing game board')
    gameStatus.value = status
    loading.value = false
  } catch (err: any) {
    console.error('[GameView] Error restoring game:', err)
    error.value = err.message || 'Failed to load game'
    loading.value = false
  }
})
</script>

<style scoped>
.game-view {
  min-height: 100vh;
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
