/**
 * REST API service for backend communication
 */

import { config } from '@/config'
import { authService } from '@/services/auth'
import type {
  LobbyCreateRequest,
  LobbyResponse,
  LobbyJoinRequest,
  LobbyJoinResponse,
  LobbyPlayerResponse,
  LobbyStateResponse,
  MessageResponse,
} from '@/types'

class ApiService {
  private baseUrl: string

  constructor() {
    this.baseUrl = config.api.baseUrl
  }

  /**
   * Create a new lobby (requires authentication via Bearer token)
   */
  async createLobby(data?: LobbyCreateRequest): Promise<LobbyResponse> {
    const token = authService.getToken()
    console.log('[API] createLobby - Token exists:', !!token, token ? `(${token.substring(0, 10)}...)` : 'null')
    
    if (!token) {
      console.error('[API] createLobby - No token found in localStorage')
      throw new Error('No authentication token found')
    }

    console.log('[API] createLobby - Making request to:', `${this.baseUrl}/api/lobbies`)
    
    const response = await fetch(`${this.baseUrl}/api/lobbies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(data || {}),
    })

    console.log('[API] createLobby - Response status:', response.status, response.statusText)

    if (!response.ok) {
      const errorBody = await response.text()
      console.error('[API] createLobby - Error response:', errorBody)
      throw new Error(`Failed to create lobby: ${response.statusText} - ${errorBody}`)
    }

    const result = await response.json()
    console.log('[API] createLobby - Success:', result)
    return result
  }

  /**
   * Get lobby by code
   */
  async getLobby(code: string): Promise<LobbyResponse> {
    const response = await fetch(`${this.baseUrl}/api/lobbies/${code}`)

    if (!response.ok) {
      throw new Error(`Failed to get lobby: ${response.statusText}`)
    }

    return response.json()
  }

  /**
   * List all active lobbies
   */
  async listActiveLobbies(): Promise<LobbyResponse[]> {
    const response = await fetch(`${this.baseUrl}/api/lobbies`)

    if (!response.ok) {
      throw new Error(`Failed to list lobbies: ${response.statusText}`)
    }

    return response.json()
  }

  /**
   * Get complete lobby state (for page refresh/reconnection)
   */
  async getLobbyState(code: string): Promise<LobbyStateResponse> {
    const response = await fetch(`${this.baseUrl}/api/lobbies/${code}/state`)

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(error.detail || 'Failed to get lobby state')
    }

    return response.json()
  }

  /**
   * Join a lobby (requires authentication via Bearer token)
   */
  async joinLobby(code: string): Promise<LobbyJoinResponse> {
    const token = authService.getToken()
    if (!token) {
      throw new Error('No authentication token found')
    }

    const response = await fetch(`${this.baseUrl}/api/lobbies/${code}/join`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }))
      throw new Error(error.message || error.detail || 'Failed to join lobby')
    }

    return response.json()
  }

  /**
   * Leave a lobby
   */
  async leaveLobby(code: string, playerId: string): Promise<MessageResponse> {
    const response = await fetch(`${this.baseUrl}/api/lobbies/${code}/leave`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ player_id: playerId }),
    })

    if (!response.ok) {
      throw new Error(`Failed to leave lobby: ${response.statusText}`)
    }

    return response.json()
  }

  /**
   * Get players in a lobby
   */
  async getLobbyPlayers(code: string): Promise<LobbyPlayerResponse[]> {
    const response = await fetch(`${this.baseUrl}/api/lobbies/${code}/players`)

    if (!response.ok) {
      throw new Error(`Failed to get lobby players: ${response.statusText}`)
    }

    return response.json()
  }

  /**
   * Close a lobby
   */
  async closeLobby(code: string): Promise<MessageResponse> {
    const response = await fetch(`${this.baseUrl}/api/lobbies/${code}`, {
      method: 'DELETE',
    })

    if (!response.ok) {
      throw new Error(`Failed to close lobby: ${response.statusText}`)
    }

    return response.json()
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{ status: string }> {
    const response = await fetch(`${this.baseUrl}/health`)

    if (!response.ok) {
      throw new Error('Health check failed')
    }

    return response.json()
  }
}

// Export singleton instance
export const apiService = new ApiService()
