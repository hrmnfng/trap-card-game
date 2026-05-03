<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterView } from 'vue-router'
import { useGameStore } from '@/stores/game'

const gameStore = useGameStore()

onMounted(async () => {
  // Check for saved session on app start
  await gameStore.checkForSavedSession()
})
</script>

<template>
  <!-- Reconnection Prompt Modal -->
  <div v-if="gameStore.showReconnectPrompt" class="modal-overlay">
    <div class="modal-content">
      <h2>Resume Previous Session?</h2>
      <p>You were previously in lobby <strong>{{ gameStore.pendingSession?.lobbyCode }}</strong> as <strong>{{ gameStore.pendingSession?.username }}</strong></p>
      <p class="hint">Your game progress will be restored.</p>
      
      <div class="modal-actions">
        <button class="btn btn-secondary" @click="gameStore.cancelReconnection()">
          Start Fresh
        </button>
        <button class="btn btn-primary" @click="gameStore.confirmReconnection()">
          Resume Game
        </button>
      </div>
    </div>
  </div>

  <!-- Main App Content -->
  <RouterView />
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  background: #f5f5f5;
}

#app {
  min-height: 100vh;
}

/* Modal Overlay */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  padding: 1rem;
}

.modal-content {
  background: white;
  border-radius: 12px;
  padding: 1.5rem;
  max-width: 400px;
  width: 100%;
  text-align: center;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
}

.modal-content h2 {
  font-size: 1.25rem;
  color: #1a202c;
  margin-bottom: 1rem;
}

.modal-content p {
  color: #4a5568;
  margin-bottom: 0.5rem;
}

.modal-content strong {
  color: #2d3748;
}

.modal-content .hint {
  font-size: 0.875rem;
  color: #718096;
  margin-top: 0.5rem;
}

.modal-actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 1.5rem;
}

.modal-actions .btn {
  flex: 1;
  padding: 0.75rem 1rem;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.modal-actions .btn-primary {
  background: #4a5568;
  color: white;
}

.modal-actions .btn-primary:hover {
  background: #2d3748;
}

.modal-actions .btn-secondary {
  background: #e2e8f0;
  color: #4a5568;
}

.modal-actions .btn-secondary:hover {
  background: #cbd5e0;
}
</style>