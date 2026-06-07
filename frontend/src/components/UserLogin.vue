<template>
  <div class="user-login">
    <div class="card">
      <h2>Login or Create an Account</h2>

      <div class="tabs">
        <button :class="{ active: mode === 'login' }" @click="mode = 'login'">
          Login
        </button>
        <button :class="{ active: mode === 'register' }" @click="mode = 'register'">
          Register
        </button>
      </div>

      <!-- Login form -->
      <div v-if="mode === 'login'" class="mode-content">
        <p class="description">Login with your existing account</p>

        <div class="form-group">
          <label for="username-login">Username</label>
          <input
            id="username-login"
            v-model="credentials.username"
            type="text"
            placeholder="Enter your username"
            maxlength="50"
            @keyup.enter="handleLogin"
          />

          <label for="password-login">Password (4-6 digits)</label>
          <input
            id="password-login"
            v-model="credentials.password"
            type="password"
            placeholder="Enter your password"
            maxlength="6"
            inputmode="numeric"
            @keyup.enter="handleLogin"
          />
        </div>

        <button
          class="btn btn-primary"
          :disabled="!isFormValid || authStore.loading"
          @click="handleLogin"
        >
          {{ authStore.loading ? 'Logging in...' : 'Login' }}
        </button>
      </div>

      <!-- Register form -->
      <div v-else class="mode-content">
        <p class="description">Create a new account</p>

        <div class="form-group">
          <label for="username-register">Username</label>
          <input
            id="username-register"
            v-model="credentials.username"
            type="text"
            placeholder="Choose a username"
            maxlength="50"
            @keyup.enter="handleRegister"
          />

          <label for="password-register">Password (4-6 digits)</label>
          <input
            id="password-register"
            v-model="credentials.password"
            type="password"
            placeholder="Create a password with 4-6 digits"
            maxlength="6"
            inputmode="numeric"
            @keyup.enter="handleRegister"
          />
          <p class="password-hint">
            Password must be 4-6 digits only (e.g., 1234, 0000, 123456)
          </p>
        </div>

        <button
          class="btn btn-primary"
          :disabled="!isFormValid || authStore.loading"
          @click="handleRegister"
        >
          {{ authStore.loading ? 'Creating account...' : 'Register' }}
        </button>
      </div>

      <!-- Error Message -->
      <div v-if="authStore.error" class="error-message">
        {{ authStore.error }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const authStore = useAuthStore()

// State
const mode = ref<'login' | 'register'>('login')
const credentials = ref({
  username: '',
  password: '',
})

// Computed
const isFormValid = computed(() => {
  const { username, password } = credentials.value
  // Password must be 4-6 digits
  const isValidPassword = /^\d{4,6}$/.test(password)
  return username.length > 0 && isValidPassword
})

// Handlers
async function handleLogin() {
  if (!isFormValid.value) return

  try {
    await authStore.login(credentials.value)
    // Navigate to home page to create/join lobbies
    router.push('/')
  } catch (err) {
    // Error is already set in store
    console.error('Login failed:', err)
  }
}

async function handleRegister() {
  if (!isFormValid.value) return

  try {
    await authStore.register(credentials.value)
    // Navigate to home page to create/join lobbies
    router.push('/')
  } catch (err) {
    // Error is already set in store
    console.error('Registration failed:', err)
  }
}
</script>

<style scoped>
.user-login {
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
  margin-bottom: 8px;
}

input:focus {
  outline: none;
  border-color: #42b983;
}

.password-hint {
  margin: 0;
  font-size: 12px;
  color: #999;
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
