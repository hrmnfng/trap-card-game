/**
 * REST API service for backend communication
 */

import { config } from '@/config'
import type {
  LobbyCreateRequest,
  LobbyResponse,
  LobbyJoinRequest,
  LobbyPlayerResponse,
  MessageResponse,
} from '@/types'

class ApiService {
  private baseUrl: string

  constructor() {
    this.baseUrl = config.api.baseUrl
  }

  /**
   * Create a new lobby
   */
  async createLobby(data?: LobbyCreateRequest): Promise<LobbyResponse> {
    const response = await fetch(`${this.baseUrl}/api/lobbies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data || {}),
    })

    if (!response.ok) {
      throw new Error(`Failed to create lobby: ${response.statusText}`)
    }

    return response.json()
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
   * Join a lobby
   */
  async joinLobby(code: string, data: LobbyJoinRequest): Promise<MessageResponse> {
    const response = await fetch(`${this.baseUrl}/api/lobbies/${code}/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
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
