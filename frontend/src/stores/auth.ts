/**
 * Pinia store for authentication state management
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authService } from '@/services/auth'
import type { AuthCredentials } from '@/services/auth'
import { useLobbyStore } from './lobby'

export const useAuthStore = defineStore('auth', () => {
  // State
  const userId = ref<string | null>(null)
  const username = ref<string | null>(null)
  const token = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Computed
  const isAuthenticated = computed(() => userId.value !== null && token.value !== null)

  // Actions

  /**
   * Register a new user
   */
  async function register(credentials: AuthCredentials): Promise<void> {
    loading.value = true
    error.value = null

    try {
      const response = await authService.register(credentials)

      userId.value = response.user_id
      username.value = response.username
      token.value = response.token

      authService.saveToken(response.token)
    } catch (err: any) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * Login a user
   */
  async function login(credentials: AuthCredentials): Promise<void> {
    loading.value = true
    error.value = null

    try {
      const response = await authService.login(credentials)

      userId.value = response.user_id
      username.value = response.username
      token.value = response.token

      authService.saveToken(response.token)
    } catch (err: any) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * Logout current user
   */
  function logout(): void {
    userId.value = null
    username.value = null
    token.value = null
    error.value = null
    authService.clearToken()

    // Clear lobby state on logout
    const lobbyStore = useLobbyStore()
    lobbyStore.clearOnLogout()
  }

  /**
   * Restore session from localStorage
   */
  async function restoreSession(): Promise<boolean> {
    loading.value = true
    error.value = null

    try {
      const savedToken = authService.getToken()

      if (!savedToken) {
        loading.value = false
        return false
      }

      // Validate token with backend
      const response = await authService.validateSession()

      userId.value = response.user_id
      username.value = response.username
      token.value = response.token

      return true
    } catch (err: any) {
      error.value = err.message
      authService.clearToken()
      return false
    } finally {
      loading.value = false
    }
  }

  /**
   * Validate current token
   */
  async function validateToken(): Promise<boolean> {
    if (!token.value) {
      return false
    }

    try {
      await authService.validateSession()
      return true
    } catch (err: any) {
      error.value = err.message
      logout()
      return false
    }
  }

  return {
    // State
    userId,
    username,
    token,
    loading,
    error,

    // Computed
    isAuthenticated,

    // Actions
    register,
    login,
    logout,
    restoreSession,
    validateToken,
  }
})
