/**
 * Pinia store for game state management
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { wsService } from '@/services/websocket'
import { useLobbyStore } from './lobby'
import type { LobbyState, Card, Player, GameAction } from '@/types'

export const useGameStore = defineStore('game', () => {
  // State
  const gameState = ref<LobbyState | null>(null)
  const connected = ref(false)
  const error = ref<string | null>(null)
  const gameStarting = ref(false)

  // Computed
  const myCards = computed(() => gameState.value?.my_cards || [])
  const players = computed(() => gameState.value?.players || [])
  const gameHistory = computed(() => gameState.value?.game_history || [])
  const isGameStarted = computed(() => gameState.value?.status === 'active')
  const isGameEnded = computed(() => gameState.value?.status === 'ended')
  const myCardsRemaining = computed(() => myCards.value.length)

  const me = computed(() => {
    const lobbyStore = useLobbyStore()
    if (!lobbyStore.currentPlayerId) return null
    return players.value.find((p) => p.id === lobbyStore.currentPlayerId)
  })

  // Actions

  /**
   * Connect to WebSocket
   */
  async function connect(lobbyCode: string, playerId: string): Promise<void> {
    error.value = null

    try {
      await wsService.connect(lobbyCode, playerId)
      connected.value = true

      // Register event handlers
      wsService.on('connected', handleConnected)
      wsService.on('state_update', handleStateUpdate)
      wsService.on('player_joined', handlePlayerJoined)
      wsService.on('player_left', handlePlayerLeft)
      wsService.on('game_started', handleGameStarted)
      wsService.on('card_played', handleCardPlayed)
      wsService.on('game_ended', handleGameEnded)
      wsService.on('error', handleError)

      // Request initial state
      wsService.requestState()
    } catch (err: any) {
      error.value = err.message
      connected.value = false
      throw err
    }
  }

  /**
   * Disconnect from WebSocket
   */
  function disconnect(): void {
    wsService.disconnect()
    connected.value = false
    gameState.value = null
  }

  /**
   * Start the game
   */
  function startGame(): void {
    if (!connected.value) {
      error.value = 'Not connected to game'
      return
    }

    wsService.startGame()
  }

  /**
   * Play a card
   */
  function playCard(cardId: string, targetPlayerId: string): void {
    if (!connected.value) {
      error.value = 'Not connected to game'
      return
    }

    wsService.playCard(cardId, targetPlayerId)
  }

  /**
   * Request game state update
   */
  function requestState(): void {
    if (!connected.value) return
    wsService.requestState()
  }

  // Event Handlers

  function handleConnected(event: any): void {
    console.log('Connected to game:', event)
  }

  function handleStateUpdate(event: any): void {
    if (event.state) {
      gameState.value = event.state
    }
  }

  function handlePlayerJoined(event: any): void {
    console.log('Player joined:', event)

    // Refresh state to get updated player list
    requestState()

    // Update lobby store
    const lobbyStore = useLobbyStore()
    if (event.player_id && event.username) {
      lobbyStore.addPlayer({
        id: event.player_id,
        username: event.username,
        joined_at: new Date().toISOString(),
      })
    }
  }

  function handlePlayerLeft(event: any): void {
    console.log('Player left:', event)

    // Refresh state
    requestState()

    // Update lobby store
    const lobbyStore = useLobbyStore()
    if (event.player_id) {
      lobbyStore.removePlayer(event.player_id)
    }
  }

  function handleGameStarted(event: any): void {
    console.log('Game started:', event)

    // Refresh state to get initial cards
    requestState()
  }

  function handleCardPlayed(event: any): void {
    console.log('Card played:', event)

    // Refresh state to see updated game
    requestState()
  }

  function handleGameEnded(event: any): void {
    console.log('Game ended:', event)

    // Refresh state
    requestState()
  }

  function handleError(event: any): void {
    console.error('WebSocket error:', event)
    error.value = event.message || 'An error occurred'
  }

  /**
   * Clear game state
   */
  function clearState(): void {
    gameState.value = null
    error.value = null
  }

  /**
   * Get player by ID
   */
  function getPlayer(playerId: string): Player | undefined {
    return players.value.find((p) => p.id === playerId)
  }

  /**
   * Get card by ID
   */
  function getCard(cardId: string): Card | undefined {
    return myCards.value.find((c) => c.id === cardId)
  }

  /**
   * Check if it's my turn (simplified - would need turn logic)
   */
  const isMyTurn = computed(() => {
    // This would need actual turn logic from backend
    return isGameStarted.value && myCardsRemaining.value > 0
  })

  return {
    // State
    gameState,
    connected,
    error,
    gameStarting,

    // Computed
    myCards,
    players,
    gameHistory,
    isGameStarted,
    isGameEnded,
    myCardsRemaining,
    me,
    isMyTurn,

    // Actions
    connect,
    disconnect,
    startGame,
    playCard,
    requestState,
    clearState,
    getPlayer,
    getCard,
  }
})
