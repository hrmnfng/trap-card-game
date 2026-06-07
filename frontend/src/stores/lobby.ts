/**
 * Pinia store for lobby management
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useAuthStore } from './auth'
import { apiService } from '@/services/api'
import type { LobbyResponse, LobbyPlayerResponse, LobbyStateResponse } from '@/types'

const LOBBY_CODE_STORAGE_KEY = 'trap_card_current_lobby_code'
const LOBBY_STATUS_STORAGE_KEY = 'trap_card_lobby_status'

export const useLobbyStore = defineStore('lobby', () => {
  // Get auth store once at top level
  const authStore = useAuthStore()

  // State
  const currentLobby = ref<LobbyResponse | null>(null)
  const lobbyStatus = ref<'waiting' | 'in-progress' | 'concluded' | null>(null)
  const players = ref<LobbyPlayerResponse[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const currentPlayerId = ref<string | null>(null)
  const currentPlayerUsername = ref<string | null>(null)

  // Computed
  const isInLobby = computed(() => currentLobby.value !== null)
  const lobbyCode = computed(() => currentLobby.value?.code || null)
  const playerCount = computed(() => players.value.length)
  const isLobbyFull = computed(() => playerCount.value >= 10)

  /**
   * Get authenticated username - validates user is logged in
   * Throws error if not authenticated
   */
  const authenticatedUser = computed(() => {
    if (!authStore.isAuthenticated || !authStore.username) {
      throw new Error('User not authenticated')
    }
    return authStore.username
  })

  // Actions

  /**
   * Create a new lobby
   */
  async function createLobby(): Promise<string> {
    loading.value = true
    error.value = null

    try {
      const lobby = await apiService.createLobby()
      currentLobby.value = lobby
      return lobby.code
    } catch (err: any) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * Set owner info after creating lobby (owner is first to join)
   */
  function setOwnerInfo(playerId: string, username: string): void {
    currentPlayerId.value = playerId
    currentPlayerUsername.value = username
    saveSession()
  }

  /**
   * Join a lobby
   */
  async function joinLobby(code: string): Promise<void> {
    loading.value = true
    error.value = null

    try {
      // Verify authenticated user exists (will throw if not authenticated)
      const username = authenticatedUser.value
      if (!username) {
        throw new Error('Not authenticated')
      }

      // Get lobby info
      const lobby = await apiService.getLobby(code)
      currentLobby.value = lobby

      // Join the lobby - authentication is done via Bearer token
      const joinResponse = await apiService.joinLobby(code)

      // Store player info from response
      currentPlayerUsername.value = username
      currentPlayerId.value = joinResponse.player_id

      // Get updated player list
      await refreshPlayers()

      // Save session for persistence across page refreshes
      saveSession()
    } catch (err: any) {
      error.value = err.message
      currentLobby.value = null
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * Leave current lobby
   */
  async function leaveLobby(): Promise<void> {
    if (!currentLobby.value || !currentPlayerId.value) return

    loading.value = true
    error.value = null

    try {
      await apiService.leaveLobby(currentLobby.value.code, currentPlayerId.value)
      clearLobby()
    } catch (err: any) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * Refresh lobby info
   */
  async function refreshLobby(): Promise<void> {
    if (!currentLobby.value) return

    try {
      const lobby = await apiService.getLobby(currentLobby.value.code)
      currentLobby.value = lobby
    } catch (err: any) {
      error.value = err.message
      throw err
    }
  }

  /**
   * Refresh player list
   */
  async function refreshPlayers(): Promise<void> {
    if (!currentLobby.value) return

    try {
      const lobbyPlayers = await apiService.getLobbyPlayers(currentLobby.value.code)
      players.value = lobbyPlayers

      // Set current player ID if we can find it
      if (currentPlayerUsername.value && !currentPlayerId.value) {
        const player = lobbyPlayers.find((p) => p.username === currentPlayerUsername.value)
        if (player) {
          currentPlayerId.value = player.id
        }
      }
    } catch (err: any) {
      error.value = err.message
      throw err
    }
  }

  /**
   * Close current lobby
   */
  async function closeLobby(): Promise<void> {
    if (!currentLobby.value) return

    loading.value = true
    error.value = null

    try {
      await apiService.closeLobby(currentLobby.value.code)
      clearLobby()
    } catch (err: any) {
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }

  /**
   * Clear lobby state
   */
  function clearLobby(): void {
    currentLobby.value = null
    players.value = []
    currentPlayerId.value = null
    currentPlayerUsername.value = null
    error.value = null
    clearStoredSession()
  }

  /**
   * Clear lobby on logout
   */
  function clearOnLogout(): void {
    clearLobby()
  }

  /**
   * Set current player ID
   */
  function setPlayerId(playerId: string): void {
    currentPlayerId.value = playerId
  }

  /**
   * Add player to list (from WebSocket event)
   */
  function addPlayer(player: LobbyPlayerResponse): void {
    if (!players.value.find((p) => p.id === player.id)) {
      players.value.push(player)
    }
  }

  /**
   * Remove player from list (from WebSocket event)
   */
  function removePlayer(playerId: string): void {
    players.value = players.value.filter((p) => p.id !== playerId)
  }

  /**
   * Session storage key
   */
  const SESSION_KEY = 'trapcard_session'

  /**
   * Saved session interface
   */
  interface SavedSession {
    lobbyCode: string
    playerId: string
    username: string
    savedAt: number
  }

  /**
   * Save current session to localStorage
   */
  function saveSession(): void {
    if (!currentLobby.value || !currentPlayerId.value || !currentPlayerUsername.value) {
      return
    }
    const session: SavedSession = {
      lobbyCode: currentLobby.value.code,
      playerId: currentPlayerId.value,
      username: currentPlayerUsername.value,
      savedAt: Date.now()
    }
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session))
      console.log('Session saved:', session.lobbyCode)
    } catch (err) {
      console.error('Failed to save session:', err)
    }
  }

  /**
   * Load session from localStorage
   */
  function loadSession(): SavedSession | null {
    try {
      const stored = localStorage.getItem(SESSION_KEY)
      if (!stored) return null
      const session: SavedSession = JSON.parse(stored)

      // Check if session is valid (less than 24h old)
      const maxAge = 24 * 60 * 60 * 1000 // 24 hours
      if (Date.now() - session.savedAt > maxAge) {
        clearStoredSession()
        return null
      }

      console.log('Session loaded:', session.lobbyCode)
      return session
    } catch (err) {
      console.error('Failed to load session:', err)
      return null
    }
  }

  /**
   * Clear session from localStorage
   */
  function clearStoredSession(): void {
    try {
      localStorage.removeItem(SESSION_KEY)
      console.log('Session cleared')
    } catch (err) {
      console.error('Failed to clear session:', err)
    }
  }

  /**
   * Validate session by checking lobby still exists via API
   */
  async function validateSession(): Promise<boolean> {
    const session = loadSession()
    if (!session) return false

    try {
      // Try to get lobby info - will throw if lobby doesn't exist
      await apiService.getLobby(session.lobbyCode)
      return true
    } catch {
      clearStoredSession()
      return false
    }
  }

  /**
   * Restore lobby state from code (used on page refresh)
   * Returns the lobby status to determine which view to show
   * Identifies current player by matching auth store userId with players in lobby
   */
  async function restoreLobbyState(code: string): Promise<'waiting' | 'in-progress' | 'concluded' | null> {
    console.log('[restoreLobbyState] Starting for code:', code, 'userId:', authStore.userId)
    loading.value = true
    error.value = null

    try {
      // Check if user is authenticated
      if (!authStore.userId) {
        throw new Error('User is not authenticated. Please log in first.')
      }

      console.log('[restoreLobbyState] Fetching lobby state from API')
      const state: LobbyStateResponse = await apiService.getLobbyState(code)
      
      console.log('[restoreLobbyState] API response status:', state.status, 'players:', state.players.length)
      
      // Update store with fetched state
      currentLobby.value = {
        id: state.id,
        code: state.code,
        status: state.status,
        owner_id: state.owner_id,
        created_at: state.created_at,
        expires_at: state.expires_at,
        player_count: state.player_count,
      }
      
      players.value = state.players
      lobbyStatus.value = state.status
      
      // Find current player by matching userId with players in lobby
      const currentPlayer = state.players.find(p => p.id === authStore.userId)
      if (!currentPlayer) {
        throw new Error(`User is not in this lobby. Current lobby contains ${state.players.length} player(s).`)
      }

      // Set current player info
      currentPlayerId.value = currentPlayer.id
      currentPlayerUsername.value = currentPlayer.username
      
      console.log(`[restoreLobbyState] Restored lobby ${code} with status: ${state.status}. Current player: ${currentPlayer.username}`)
      return state.status
    } catch (err: any) {
      error.value = err.message
      console.error('[restoreLobbyState] Error:', err)
      clearLobby()
      return null
    } finally {
      loading.value = false
    }
  }

  return {
    // State
    currentLobby,
    players,
    loading,
    error,
    currentPlayerId,
    currentPlayerUsername,
    lobbyStatus,

    // Computed
    isInLobby,
    lobbyCode,
    playerCount,
    isLobbyFull,
    authenticatedUser,

    // Actions
    createLobby,
    joinLobby,
    leaveLobby,
    refreshLobby,
    refreshPlayers,
    closeLobby,
    clearLobby,
    clearOnLogout,
    setPlayerId,
    setOwnerInfo,
    addPlayer,
    removePlayer,
    restoreLobbyState,

    // Session
    saveSession,
    loadSession,
    clearStoredSession,
    validateSession,
  }
})
