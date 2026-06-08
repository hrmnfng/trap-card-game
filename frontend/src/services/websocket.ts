/**
 * WebSocket service for real-time game updates
 */

import { config } from '@/config'

export type WSEventType =
  | 'connected'
  | 'state_update'
  | 'player_joined'
  | 'player_left'
  | 'game_started'
  | 'card_played'
  | 'game_ended'
  | 'error'
  | 'pong'

export interface WSEvent {
  type: WSEventType
  [key: string]: any
}

export type WSEventHandler = (event: WSEvent) => void

class WebSocketService {
  private ws: WebSocket | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000
  private eventHandlers: Map<WSEventType, Set<WSEventHandler>> = new Map()
  private lobbyCode: string | null = null
  private playerId: string | null = null
  private isIntentionallyClosed = false

  /**
   * Connect to lobby WebSocket
   */
  connect(lobbyCode: string, playerId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.lobbyCode = lobbyCode
      this.playerId = playerId
      this.isIntentionallyClosed = false

      const wsUrl = `${config.api.wsBaseUrl}/ws/lobby/${lobbyCode}?player_id=${playerId}`
      console.log('Connecting to WebSocket:', wsUrl)

      try {
        this.ws = new WebSocket(wsUrl)

        this.ws.onopen = () => {
          console.log('WebSocket connected')
          this.reconnectAttempts = 0
          resolve()
        }

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data) as WSEvent
            this.handleMessage(data)
          } catch (error) {
            console.error('Failed to parse WebSocket message:', error)
          }
        }

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error)
          reject(error)
        }

        this.ws.onclose = () => {
          console.log('WebSocket closed')
          this.ws = null

          // Attempt to reconnect if not intentionally closed
          if (!this.isIntentionallyClosed && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++
            console.log(`Reconnecting... (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`)

            setTimeout(() => {
              if (this.lobbyCode && this.playerId) {
                this.connect(this.lobbyCode, this.playerId).catch(console.error)
              }
            }, this.reconnectDelay * this.reconnectAttempts)
          }
        }
      } catch (error) {
        reject(error)
      }
    })
  }

  /**
   * Disconnect WebSocket
   */
  disconnect(): void {
    this.isIntentionallyClosed = true

    if (this.ws) {
      this.ws.close()
      this.ws = null
    }

    this.lobbyCode = null
    this.playerId = null
    this.reconnectAttempts = 0
  }

  /**
   * Send message to server
   */
  send(message: any): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('WebSocket not connected, readyState:', this.ws?.readyState)
      return
    }

    console.log('Sending WebSocket message:', message)
    this.ws.send(JSON.stringify(message))
  }

  /**
   * Request current game state
   */
  requestState(): void {
    this.send({ type: 'get_state' })
  }

  /**
   * Start the game
   */
  startGame(): void {
    this.send({ type: 'start_game' })
  }

  /**
   * Play a card
   */
  playCard(cardId: string, targetPlayerId: string): void {
    this.send({
      type: 'play_card',
      card_id: cardId,
      target_player_id: targetPlayerId,
    })
  }

  /**
   * Send ping
   */
  ping(): void {
    this.send({ type: 'ping' })
  }

  /**
   * Register event handler
   */
  on(eventType: WSEventType, handler: WSEventHandler): void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set())
    }
    this.eventHandlers.get(eventType)!.add(handler)
  }

  /**
   * Unregister event handler
   */
  off(eventType: WSEventType, handler: WSEventHandler): void {
    const handlers = this.eventHandlers.get(eventType)
    if (handlers) {
      handlers.delete(handler)
    }
  }

  /**
   * Register one-time event handler
   */
  once(eventType: WSEventType, handler: WSEventHandler): void {
    const wrappedHandler: WSEventHandler = (event) => {
      handler(event)
      this.off(eventType, wrappedHandler)
    }
    this.on(eventType, wrappedHandler)
  }

  /**
   * Handle incoming message
   */
  private handleMessage(event: WSEvent): void {
    console.log('WebSocket message:', event)

    const handlers = this.eventHandlers.get(event.type as WSEventType)
    if (handlers) {
      handlers.forEach((handler) => handler(event))
    }

    // Also trigger wildcard handlers
    const allHandlers = this.eventHandlers.get('*' as WSEventType)
    if (allHandlers) {
      allHandlers.forEach((handler) => handler(event))
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  /**
   * Get connection state
   */
  getState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED
  }
}

// Export singleton instance
export const wsService = new WebSocketService()
