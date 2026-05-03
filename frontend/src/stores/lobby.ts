/**
 * Pinia store for lobby management
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiService } from '@/services/api'
import type { LobbyResponse, LobbyPlayerResponse } from '@/types'

export const useLobbyStore = defineStore('lobby', () => {
  // State
  const currentLobby = ref<LobbyResponse | null>(null)
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
   * Join a lobby
   */
  async function joinLobby(code: string, username: string): Promise<void> {
    loading.value = true
    error.value = null

    try {
      // Get lobby info
      const lobby = await apiService.getLobby(code)
      currentLobby.value = lobby

      // Join the lobby
      const joinResponse = await apiService.joinLobby(code, { username })

      // Store player info from response
      currentPlayerUsername.value = username
      currentPlayerId.value = joinResponse.player_id

      // Get updated player list
      await refreshPlayers()
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

  return {
    // State
    currentLobby,
    players,
    loading,
    error,
    currentPlayerId,
    currentPlayerUsername,

    // Computed
    isInLobby,
    lobbyCode,
    playerCount,
    isLobbyFull,

    // Actions
    createLobby,
    joinLobby,
    leaveLobby,
    refreshLobby,
    refreshPlayers,
    closeLobby,
    clearLobby,
    setPlayerId,
    addPlayer,
    removePlayer,
  }
})
