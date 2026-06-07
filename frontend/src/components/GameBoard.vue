<template>
  <div class="game-board">
    <div class="game-container">
      <!-- Header -->
      <div class="game-header">
        <div class="lobby-info">
          <h2>Lobby {{ lobbyStore.lobbyCode }}</h2>
          <span class="game-status" :class="gameStatusClass">
            {{ gameStatusText }}
          </span>
        </div>
        <button class="btn-leave" @click="handleLeaveGame">
          Leave Game
        </button>
      </div>

      <!-- Players Grid -->
      <div class="players-grid">
        <div
          v-for="player in gameStore.players"
          :key="player.id"
          class="player-card"
          :class="{ 'is-me': player.id === lobbyStore.currentPlayerId }"
        >
          <div class="player-header">
            <span class="player-name">{{ player.username }}</span>
            <span v-if="player.id === lobbyStore.currentPlayerId" class="badge-me">You</span>
          </div>
          <div class="player-stats">
            <div class="stat">
              <span class="stat-label">Cards</span>
              <span class="stat-value">{{ player.cards_remaining }}</span>
            </div>
            <div class="stat">
              <span class="stat-label">Revealed</span>
              <span class="stat-value">{{ player.cards_revealed }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- My Cards -->
      <div class="my-cards-section">
        <h3>Your Cards</h3>
        <div v-if="gameStore.myCards.length > 0" class="cards-container">
          <div
            v-for="card in gameStore.myCards"
            :key="card.id"
            class="card-item"
            :class="{ 
              'selected': selectedCard?.id === card.id,
              'disabled': !gameStore.isMyTurn
            }"
            @click="selectCard(card)"
          >
            <div class="card-value">{{ card.value }}</div>
            <div class="card-status">{{ card.status }}</div>
          </div>
        </div>
        <div v-else class="no-cards">
          <p v-if="!gameStore.isGameStarted">Waiting for game to start...</p>
          <p v-else>No cards remaining</p>
        </div>
      </div>

      <!-- Target Selection -->
      <div v-if="selectedCard" class="target-selection">
        <h3>Select Target Player</h3>
        <div class="target-buttons">
          <button
            v-for="player in otherPlayers"
            :key="player.id"
            class="btn-target"
            :disabled="playingCard"
            @click="playCardOnTarget(player.id)"
          >
            {{ player.username }}
            <span class="target-cards">({{ player.cards_remaining }} cards)</span>
          </button>
        </div>
        <button class="btn-cancel" @click="selectedCard = null">
          Cancel
        </button>
      </div>

      <!-- Game History -->
      <div class="game-history">
        <h3>Game History</h3>
        <div class="history-list">
          <div
            v-for="action in recentHistory"
            :key="action.id"
            class="history-item"
          >
            <span class="history-player">{{ action.player_username }}</span>
            <span class="history-action">played</span>
            <span class="history-value">{{ action.card_value }}</span>
            <span class="history-action">on</span>
            <span class="history-target">{{ action.target_username }}</span>
          </div>
          <div v-if="gameStore.gameHistory.length === 0" class="no-history">
            No cards played yet
          </div>
        </div>
      </div>

      <!-- Error Message -->
      <div v-if="error" class="error-banner">
        {{ error }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useLobbyStore } from '@/stores/lobby'
import { useGameStore } from '@/stores/game'
import type { Card } from '@/types'

const router = useRouter()
const lobbyStore = useLobbyStore()
const gameStore = useGameStore()

// State
const selectedCard = ref<Card | null>(null)
const playingCard = ref(false)
const error = ref<string | null>(null)

// Computed
const gameStatusClass = computed(() => {
  if (gameStore.isGameEnded) return 'ended'
  if (gameStore.isGameStarted) return 'active'
  return 'waiting'
})

const gameStatusText = computed(() => {
  if (gameStore.isGameEnded) return 'Game Ended'
  if (gameStore.isGameStarted) return 'Active'
  return 'Waiting'
})

const otherPlayers = computed(() => {
  return gameStore.players.filter(p => p.id !== lobbyStore.currentPlayerId)
})

const recentHistory = computed(() => {
  return gameStore.gameHistory.slice(-5).reverse()
})

// Methods
function selectCard(card: Card) {
  if (!gameStore.isMyTurn) {
    error.value = 'Not your turn'
    setTimeout(() => error.value = null, 2000)
    return
  }

  if (selectedCard.value?.id === card.id) {
    selectedCard.value = null
  } else {
    selectedCard.value = card
    error.value = null
  }
}

async function playCardOnTarget(targetPlayerId: string) {
  if (!selectedCard.value) return

  playingCard.value = true
  error.value = null

  try {
    gameStore.playCard(selectedCard.value.id, targetPlayerId)
    selectedCard.value = null

    // Wait a moment for state update
    setTimeout(() => {
      gameStore.requestState()
    }, 500)
  } catch (err: any) {
    error.value = err.message || 'Failed to play card'
  } finally {
    playingCard.value = false
  }
}

async function handleLeaveGame() {
  if (confirm('Are you sure you want to leave the game?')) {
    try {
      gameStore.disconnect()
      await lobbyStore.leaveLobby()
      router.push('/')
    } catch (err) {
      console.error('Failed to leave game:', err)
    }
  }
}

// Lifecycle
onMounted(async () => {
  // Verify we have essential info before connecting
  if (!lobbyStore.lobbyCode) {
    error.value = 'Missing lobby code'
    return
  }
  
  if (!lobbyStore.currentPlayerId) {
    error.value = 'Player ID not set. Please refresh the page.'
    return
  }

  // Connect to WebSocket if not already connected
  if (!gameStore.connected) {
    try {
      await gameStore.connect(lobbyStore.lobbyCode, lobbyStore.currentPlayerId)
      gameStore.requestState()
    } catch (err) {
      console.error('Failed to connect to game:', err)
      error.value = 'Failed to connect to game'
    }
  }
})

onUnmounted(() => {
  // Don't disconnect here - let the lobby store handle it
})
</script>

<style scoped>
.game-board {
  min-height: 100vh;
  padding: 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.game-container {
  max-width: 1200px;
  margin: 0 auto;
}

.game-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  padding: 20px;
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.lobby-info {
  display: flex;
  align-items: center;
  gap: 16px;
}

h2 {
  margin: 0;
  color: #2c3e50;
  font-size: 24px;
}

.game-status {
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 600;
}

.game-status.waiting {
  background: #ffeaa7;
  color: #d63031;
}

.game-status.active {
  background: #a8e6cf;
  color: #00b894;
}

.game-status.ended {
  background: #dfe6e9;
  color: #636e72;
}

.btn-leave {
  padding: 10px 20px;
  background: #e74c3c;
  color: white;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-leave:hover {
  background: #c0392b;
  transform: translateY(-2px);
}

.players-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.player-card {
  background: white;
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  border: 2px solid transparent;
  transition: all 0.2s;
}

.player-card.is-me {
  border-color: #42b983;
  background: #f0fdf4;
}

.player-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.player-name {
  font-weight: 600;
  color: #2c3e50;
}

.badge-me {
  padding: 4px 8px;
  background: #42b983;
  color: white;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
}

.player-stats {
  display: flex;
  gap: 16px;
}

.stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px;
  background: #f8f8f8;
  border-radius: 8px;
}

.stat-label {
  font-size: 12px;
  color: #666;
  margin-bottom: 4px;
}

.stat-value {
  font-size: 20px;
  font-weight: 700;
  color: #2c3e50;
}

.my-cards-section {
  margin-bottom: 24px;
  padding: 20px;
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

h3 {
  margin: 0 0 16px 0;
  color: #2c3e50;
  font-size: 18px;
}

.cards-container {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.card-item {
  width: 100px;
  height: 140px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.3s;
  border: 3px solid transparent;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
}

.card-item:hover:not(.disabled) {
  transform: translateY(-8px) scale(1.05);
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.3);
}

.card-item.selected {
  border-color: #ffd700;
  transform: translateY(-8px) scale(1.05);
}

.card-item.disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.card-value {
  font-size: 48px;
  font-weight: 700;
  color: white;
  text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
}

.card-status {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.8);
  margin-top: 8px;
}

.no-cards {
  text-align: center;
  padding: 40px;
  color: #666;
  font-style: italic;
}

.target-selection {
  margin-bottom: 24px;
  padding: 20px;
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  animation: slideIn 0.3s;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.target-buttons {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.btn-target {
  flex: 1;
  min-width: 150px;
  padding: 12px 20px;
  background: #42b983;
  color: white;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.btn-target:hover:not(:disabled) {
  background: #3aa876;
  transform: translateY(-2px);
}

.btn-target:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.target-cards {
  font-size: 12px;
  opacity: 0.8;
}

.btn-cancel {
  width: 100%;
  padding: 10px;
  background: #e0e0e0;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
  color: #666;
}

.btn-cancel:hover {
  background: #d0d0d0;
}

.game-history {
  padding: 20px;
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 200px;
  overflow-y: auto;
}

.history-item {
  padding: 12px;
  background: #f8f8f8;
  border-radius: 8px;
  font-size: 14px;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.history-player,
.history-target {
  font-weight: 600;
  color: #42b983;
}

.history-value {
  font-weight: 700;
  color: #667eea;
  padding: 2px 8px;
  background: white;
  border-radius: 4px;
}

.history-action {
  color: #666;
}

.no-history {
  text-align: center;
  padding: 20px;
  color: #999;
  font-style: italic;
}

.error-banner {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  padding: 16px 24px;
  background: #fee;
  border: 2px solid #fcc;
  border-radius: 8px;
  color: #c33;
  font-weight: 600;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
  z-index: 1000;
  animation: slideDown 0.3s;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translate(-50%, -20px);
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}
</style>
