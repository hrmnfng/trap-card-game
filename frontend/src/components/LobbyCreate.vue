<template>
  <div class="lobby-create">
    <div class="card">
      <h2>Trap Card Game</h2>
      
      <div class="tabs">
        <button
          :class="{ active: mode === 'create' }"
          @click="mode = 'create'"
        >
          Create Lobby
        </button>
        <button
          :class="{ active: mode === 'join' }"
          @click="mode = 'join'"
        >
          Join Lobby
        </button>
      </div>

      <!-- Create Lobby -->
      <div v-if="mode === 'create'" class="mode-content">
        <p class="description">Create a new game lobby and invite friends</p>
        
        <div class="form-group">
          <label for="username-create">Your Username</label>
          <input
            id="username-create"
            v-model="usernameCreate"
            type="text"
            placeholder="Enter your username"
            maxlength="50"
            @keyup.enter="handleCreateLobby"
          />
        </div>

        <button
          class="btn btn-primary"
          :disabled="!usernameCreate || loading"
          @click="handleCreateLobby"
        >
          {{ loading ? 'Creating...' : 'Create Lobby' }}
        </button>
      </div>

      <!-- Join Lobby -->
      <div v-else class="mode-content">
        <p class="description">Join an existing lobby with a code</p>
        
        <div class="form-group">
          <label for="lobby-code">Lobby Code</label>
          <input
            id="lobby-code"
            v-model="lobbyCodeInput"
            type="text"
            placeholder="ABC123"
            maxlength="6"
            class="lobby-code-input"
            @input="lobbyCodeInput = lobbyCodeInput.toUpperCase()"
            @keyup.enter="handleJoinLobby"
          />
        </div>

        <div class="form-group">
          <label for="username-join">Your Username</label>
          <input
            id="username-join"
            v-model="usernameJoin"
            type="text"
            placeholder="Enter your username"
            maxlength="50"
            @keyup.enter="handleJoinLobby"
          />
        </div>

        <button
          class="btn btn-primary"
          :disabled="!lobbyCodeInput || !usernameJoin || loading"
          @click="handleJoinLobby"
        >
          {{ loading ? 'Joining...' : 'Join Lobby' }}
        </button>
      </div>

      <!-- Error Message -->
      <div v-if="error" class="error-message">
        {{ error }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useLobbyStore } from '@/stores/lobby'

const router = useRouter()
const lobbyStore = useLobbyStore()

// State
const mode = ref<'create' | 'join'>('create')
const usernameCreate = ref('')
const usernameJoin = ref('')
const lobbyCodeInput = ref('')
const loading = ref(false)
const error = ref<string | null>(null)

// Handlers
async function handleCreateLobby() {
  if (!usernameCreate.value) return

  loading.value = true
  error.value = null

  try {
    // Create lobby
    const code = await lobbyStore.createLobby()
    
    // Join the lobby
    await lobbyStore.joinLobby(code, usernameCreate.value)
    
    // Navigate to lobby
    router.push(`/lobby/${code}`)
  } catch (err: any) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

async function handleJoinLobby() {
  if (!lobbyCodeInput.value || !usernameJoin.value) return

  loading.value = true
  error.value = null

  try {
    await lobbyStore.joinLobby(lobbyCodeInput.value, usernameJoin.value)
    router.push(`/lobby/${lobbyCodeInput.value}`)
  } catch (err: any) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.lobby-create {
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
  max-width: 450px;
}

h2 {
  margin: 0 0 24px 0;
  text-align: center;
  color: #2c3e50;
}

.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 24px;
  border-bottom: 2px solid #e0e0e0;
}

.tabs button {
  flex: 1;
  padding: 12px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  cursor: pointer;
  font-size: 16px;
  color: #666;
  transition: all 0.2s;
}

.tabs button.active {
  color: #42b983;
  border-bottom-color: #42b983;
  font-weight: 600;
}

.tabs button:hover:not(.active) {
  color: #333;
}

.mode-content {
  animation: fadeIn 0.3s;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.description {
  margin: 0 0 24px 0;
  text-align: center;
  color: #666;
  font-size: 14px;
}

.form-group {
  margin-bottom: 20px;
}

label {
  display: block;
  margin-bottom: 8px;
  color: #2c3e50;
  font-weight: 500;
  font-size: 14px;
}

input {
  width: 100%;
  padding: 12px;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  font-size: 16px;
  transition: border-color 0.2s;
  box-sizing: border-box;
}

input:focus {
  outline: none;
  border-color: #42b983;
}

.lobby-code-input {
  text-transform: uppercase;
  letter-spacing: 2px;
  font-weight: 600;
  text-align: center;
}

.btn {
  width: 100%;
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
  box-shadow: 0 4px 8px rgba(66, 185, 131, 0.3);
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.error-message {
  margin-top: 16px;
  padding: 12px;
  background: #fee;
  border: 1px solid #fcc;
  border-radius: 8px;
  color: #c33;
  font-size: 14px;
  text-align: center;
}
</style>
