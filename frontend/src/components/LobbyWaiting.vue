<template>
  <div class="lobby-waiting">
    <div class="card">
      <div class="header">
        <h2>Lobby {{ lobbyStore.lobbyCode }}</h2>
        <button class="btn-icon" @click="copyLobbyCode" :title="copied ? 'Copied!' : 'Copy code'">
          {{ copied ? '✓' : '📋' }}
        </button>
      </div>

      <div class="status">
        <span class="status-badge" :class="statusClass">
          {{ statusText }}
        </span>
        <span class="player-count">
          {{ lobbyStore.playerCount }} / 10 players
        </span>
      </div>

      <!-- Players List -->
      <div class="players-section">
        <h3>Players</h3>
        <div class="players-list">
          <div
            v-for="player in lobbyStore.players"
            :key="player.id"
            class="player-item"
            :class="{ 'is-me': player.id === lobbyStore.currentPlayerId }"
          >
            <span class="player-name">{{ player.username }}</span>
            <span v-if="player.id === lobbyStore.currentPlayerId" class="badge">You</span>
          </div>

          <!-- Empty slots -->
          <div
            v-for="i in (10 - lobbyStore.playerCount)"
            :key="`empty-${i}`"
            class="player-item empty"
          >
            <span class="player-name">Waiting for player...</span>
          </div>
        </div>
      </div>

      <!-- Actions -->
      <div class="actions">
        <button
          v-if="gameStore.isGameStarted"
          class="btn btn-primary"
          @click="goToGame"
        >
          Enter Game
        </button>
        <button
          v-else-if="canStartGame"
          class="btn btn-primary"
          @click="startGame"
          :disabled="starting"
        >
          {{ starting ? 'Starting...' : 'Start Game' }}
        </button>
        <button
          class="btn btn-secondary"
          @click="handleLeaveLobby"
        >
          Leave Lobby
        </button>
      </div>

      <!-- Connection Status -->
      <div class="connection-status" :class="{ connected: gameStore.connected }">
        <span class="status-dot"></span>
        {{ gameStore.connected ? 'Connected' : 'Connecting...' }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useLobbyStore } from '@/stores/lobby'
import { useGameStore } from '@/stores/game'

const router = useRouter()
const lobbyStore = useLobbyStore()
const gameStore = useGameStore()

// State
const copied = ref(false)
const starting = ref(false)

// Computed
const canStartGame = computed(() => {
  return lobbyStore.playerCount >= 2 && !gameStore.isGameStarted
})

const statusClass = computed(() => {
  if (gameStore.isGameStarted) return 'active'
  if (canStartGame.value) return 'ready'
  return 'waiting'
})

const statusText = computed(() => {
  if (gameStore.isGameStarted) return 'Game Active'
  if (canStartGame.value) return 'Ready to Start'
  return 'Waiting for Players'
})

// Methods
async function copyLobbyCode() {
  if (!lobbyStore.lobbyCode) return

  try {
    await navigator.clipboard.writeText(lobbyStore.lobbyCode)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch (err) {
    console.error('Failed to copy:', err)
  }
}

async function startGame() {
  starting.value = true
  
  try {
    // Request game start via WebSocket
    // This would be implemented in the backend
    // For now, just navigate to game when it starts
  } catch (err) {
    console.error('Failed to start game:', err)
  } finally {
    starting.value = false
  }
}

function goToGame() {
  router.push(`/game/${lobbyStore.lobbyCode}`)
}

async function handleLeaveLobby() {
  try {
    gameStore.disconnect()
    await lobbyStore.leaveLobby()
    router.push('/')
  } catch (err) {
    console.error('Failed to leave lobby:', err)
  }
}

// Lifecycle
onMounted(async () => {
  // Connect to WebSocket if we have lobby and player info
  if (lobbyStore.lobbyCode && lobbyStore.currentPlayerId) {
    try {
      await gameStore.connect(lobbyStore.lobbyCode, lobbyStore.currentPlayerId)
    } catch (err) {
      console.error('Failed to connect to game:', err)
    }
  }

  // Refresh players periodically
  const interval = setInterval(() => {
    if (lobbyStore.isInLobby) {
      lobbyStore.refreshPlayers()
    }
  }, 5000)

  onUnmounted(() => {
    clearInterval(interval)
  })
})

onUnmounted(() => {
  gameStore.disconnect()
})
</script>

<style scoped>
.lobby-waiting {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  padding: 20px;
}

.card {
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  padding: 32px;
  width: 100%;
  max-width: 600px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

h2 {
  margin: 0;
  color: #2c3e50;
  font-size: 24px;
}

.btn-icon {
  width: 40px;
  height: 40px;
  border: none;
  background: #f0f0f0;
  border-radius: 8px;
  cursor: pointer;
  font-size: 18px;
  transition: all 0.2s;
}

.btn-icon:hover {
  background: #e0e0e0;
  transform: scale(1.05);
}

.status {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  padding: 12px;
  background: #f8f8f8;
  border-radius: 8px;
}

.status-badge {
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 600;
}

.status-badge.waiting {
  background: #ffeaa7;
  color: #d63031;
}

.status-badge.ready {
  background: #a8e6cf;
  color: #00b894;
}

.status-badge.active {
  background: #74b9ff;
  color: #0984e3;
}

.player-count {
  font-size: 14px;
  color: #666;
  font-weight: 500;
}

.players-section {
  margin-bottom: 24px;
}

h3 {
  margin: 0 0 12px 0;
  font-size: 18px;
  color: #2c3e50;
}

.players-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.player-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  background: #f8f8f8;
  border-radius: 8px;
  border: 2px solid transparent;
  transition: all 0.2s;
}

.player-item.is-me {
  background: #e8f5e9;
  border-color: #42b983;
}

.player-item.empty {
  opacity: 0.5;
  font-style: italic;
}

.player-name {
  font-weight: 500;
  color: #2c3e50;
}

.badge {
  padding: 4px 8px;
  background: #42b983;
  color: white;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
}

.actions {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

.btn {
  flex: 1;
  padding: 14px;
  border: none;
  border-radius: 8px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary {
  background: #42b983;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #3aa876;
  transform: translateY(-2px);
}

.btn-secondary {
  background: #e0e0e0;
  color: #666;
}

.btn-secondary:hover {
  background: #d0d0d0;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.connection-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px;
  border-radius: 6px;
  background: #fee;
  color: #c33;
  font-size: 14px;
  font-weight: 500;
}

.connection-status.connected {
  background: #e8f5e9;
  color: #2e7d32;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
</style>
