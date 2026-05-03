/**
 * Pinia store for game state management
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { wsService } from '@/services/websocket'
import { useLobbyStore } from './lobby'
import type { LobbyState, Card, Player } from '@/types'

export const useGameStore = defineStore('game', () => {
  // Router
  const router = useRouter()
  
  // State
  const gameState = ref<LobbyState | null>(null)
  const connected = ref(false)
  const error = ref<string | null>(null)
  const gameStarting = ref(false)

  // Session restoration state
  const isRestoringSession = ref(false)
  const showReconnectPrompt = ref(false)
  const pendingSession = ref<{
    lobbyCode: string
    playerId: string
    username: string
  } | null>(null)

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

    // Session restoration
    isRestoringSession,
    showReconnectPrompt,
    pendingSession,
    checkForSavedSession,
    confirmReconnection,
    cancelReconnection,
  }

  /**
   * Check for saved session and show reconnect prompt
   */
  async function checkForSavedSession(): Promise<boolean> {
    const lobbyStore = useLobbyStore()
    const session = lobbyStore.loadSession()

    if (!session) return false

    // Validate session still exists
    const valid = await lobbyStore.validateSession()
    if (!valid) return false

    // Store pending session for user confirmation
    pendingSession.value = {
      lobbyCode: session.lobbyCode,
      playerId: session.playerId,
      username: session.username
    }

    // Show reconnect prompt
    showReconnectPrompt.value = true
    return true
  }

  /**
   * User confirmed reconnection
   */
  async function confirmReconnection(): Promise<void> {
    if (!pendingSession.value) return

    showReconnectPrompt.value = false
    isRestoringSession.value = true

    const session = pendingSession.value
    const lobbyStore = useLobbyStore()

    try {
      // Load lobby info
      await lobbyStore.refreshLobby()
      await lobbyStore.refreshPlayers()

      // Set player info
      lobbyStore.currentPlayerId = session.playerId
      lobbyStore.currentPlayerUsername = session.username

      // Connect to WebSocket
      await connect(session.lobbyCode, session.playerId)

      // Route to appropriate page based on game status
      if (isGameStarted.value) {
        await router.push(`/game/${session.lobbyCode}`)
      } else {
        await router.push(`/lobby/${session.lobbyCode}`)
      }
    } catch (err) {
      console.error('Failed to restore session:', err)
      isRestoringSession.value = false
      pendingSession.value = null
    }
  }

  /**
   * User cancelled reconnection
   */
  function cancelReconnection(): void {
    showReconnectPrompt.value = false
    pendingSession.value = null
    isRestoringSession.value = false
  }
})
