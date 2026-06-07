<template>
  <div class="home-view">
    <div class="container">
      <!-- Create New Lobby Section -->
      <section class="section create-section">
        <h2>Create New Game</h2>
        <LobbyCreate />
      </section>

      <!-- Lobby History Section -->
      <section class="section history-section">
        <h2>Game History</h2>
        
        <!-- Loading state -->
        <div v-if="historyLoading" class="loading">
          <p>Loading your games...</p>
        </div>

        <!-- Error state -->
        <div v-else-if="historyError" class="error-message">
          <p>{{ historyError }}</p>
        </div>

        <!-- Empty state -->
        <div v-else-if="lobbyHistory.length === 0" class="empty-state">
          <p>No games yet. Create one above to get started!</p>
        </div>

        <!-- Lobby history list -->
        <div v-else class="history-list">
          <div
            v-for="lobby in lobbyHistory"
            :key="lobby.id"
            class="history-item"
            :class="`status-${lobby.status}`"
          >
            <div class="item-header">
              <div class="lobby-info">
                <h3>{{ lobby.code }}</h3>
                <span class="status-badge" :class="`status-${lobby.status}`">
                  {{ formatStatus(lobby.status) }}
                </span>
              </div>
              <button
                v-if="lobby.status !== 'concluded'"
                class="btn-rejoin"
                @click="rejoinLobby(lobby.code)"
              >
                Rejoin
              </button>
            </div>

            <div class="item-details">
              <div class="detail">
                <span class="label">Owner:</span>
                <span class="value">{{ lobby.owner_username || 'Unknown' }}</span>
              </div>
              <div class="detail">
                <span class="label">Players:</span>
                <span class="value">{{ lobby.player_count }}</span>
              </div>
              <div class="detail">
                <span class="label">Created:</span>
                <span class="value">{{ formatDate(lobby.created_at) }}</span>
              </div>
              <div class="detail">
                <span class="label">Joined:</span>
                <span class="value">{{ formatDate(lobby.joined_at) }}</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import LobbyCreate from '@/components/LobbyCreate.vue'
import { apiService } from '@/services/api'
import type { LobbyHistoryItem } from '@/types'

const router = useRouter()

const lobbyHistory = ref<LobbyHistoryItem[]>([])
const historyLoading = ref(true)
const historyError = ref<string | null>(null)

onMounted(async () => {
  console.log('[HomeView] Mounted, loading lobby history')
  await loadLobbyHistory()
})

async function loadLobbyHistory() {
  historyLoading.value = true
  historyError.value = null

  try {
    console.log('[HomeView] Fetching lobby history from API')
    const history = await apiService.getLobbyHistory()
    console.log('[HomeView] Got history:', history)
    lobbyHistory.value = history
  } catch (err: any) {
    console.error('[HomeView] Failed to load lobby history:', err)
    historyError.value = err.message || 'Failed to load game history'
  } finally {
    historyLoading.value = false
  }
}

function formatStatus(status: string): string {
  const statusMap: Record<string, string> = {
    'waiting': 'Waiting',
    'in-progress': 'In Progress',
    'concluded': 'Concluded',
  }
  return statusMap[status] || status
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

async function rejoinLobby(code: string) {
  // Route to the lobby
  await router.push({ name: 'lobby', params: { code } })
}
</script>

<style scoped>
.home-view {
  min-height: 100vh;
  padding: 40px 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.container {
  max-width: 1200px;
  margin: 0 auto;
}

.section {
  background: white;
  border-radius: 12px;
  padding: 30px;
  margin-bottom: 30px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.section h2 {
  margin-top: 0;
  margin-bottom: 20px;
  color: #2c3e50;
  font-size: 24px;
}

.loading,
.error-message,
.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: #666;
}

.error-message {
  background-color: #fee;
  color: #c33;
  border-radius: 8px;
  padding: 20px;
}

.history-list {
  display: grid;
  gap: 15px;
}

.history-item {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 20px;
  transition: all 0.2s;
}

.history-item:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.history-item.status-waiting {
  border-left: 4px solid #ffc107;
}

.history-item.status-in-progress {
  border-left: 4px solid #28a745;
}

.history-item.status-concluded {
  border-left: 4px solid #6c757d;
  opacity: 0.7;
}

.item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
}

.lobby-info {
  display: flex;
  align-items: center;
  gap: 15px;
}

.lobby-info h3 {
  margin: 0;
  font-size: 20px;
  color: #2c3e50;
  font-weight: 600;
}

.status-badge {
  display: inline-block;
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
}

.status-badge.status-waiting {
  background-color: #fff3cd;
  color: #856404;
}

.status-badge.status-in-progress {
  background-color: #d4edda;
  color: #155724;
}

.status-badge.status-concluded {
  background-color: #e2e3e5;
  color: #383d41;
}

.btn-rejoin {
  padding: 8px 20px;
  background-color: #007bff;
  color: white;
  border: none;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.2s;
}

.btn-rejoin:hover {
  background-color: #0056b3;
}

.item-details {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 15px;
  padding-top: 15px;
  border-top: 1px solid #e0e0e0;
}

.detail {
  display: flex;
  flex-direction: column;
}

.detail .label {
  font-size: 12px;
  color: #999;
  text-transform: uppercase;
  font-weight: 600;
  margin-bottom: 4px;
}

.detail .value {
  font-size: 14px;
  color: #333;
}

@media (max-width: 768px) {
  .container {
    padding: 0;
  }

  .section {
    border-radius: 0;
    margin-bottom: 0;
  }

  .item-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .btn-rejoin {
    align-self: flex-start;
    margin-top: 10px;
  }

  .item-details {
    grid-template-columns: 1fr;
  }
}
</style>
