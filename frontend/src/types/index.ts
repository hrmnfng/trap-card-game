/**
 * TypeScript type definitions for the application
 */

export interface Player {
  id: string
  username: string
  cards_revealed: number
  cards_remaining: number
}

export interface Card {
  id: string
  value: number | null
  status: 'hidden' | 'revealed'
  owner_id: string
}

export interface GameAction {
  id: string
  action_type: string
  player_id: string
  player_username: string
  target_id: string | null
  target_username: string | null
  card_value: number | null
  timestamp: string
}

export interface LobbyState {
  lobby_id: string
  lobby_code: string
  status: 'waiting' | 'active' | 'ended'
  players: Player[]
  my_cards: Card[]
  game_history: GameAction[]
}

export interface LobbyCreateRequest {
  player_username: string
}

export interface LobbyResponse {
  lobby_code: string
  lobby_id: string
  player_id: string
  jwt_token: string
}

export interface CardPlayRequest {
  card_id: string
  target_player_id: string
}

export interface FCMTokenRequest {
  player_id: string
  fcm_token: string
}

// WebSocket message types
export type WSMessageType = 'join' | 'play_card' | 'get_state' | 'state_update' | 'error'

export interface WSMessage {
  type: WSMessageType
  data?: any
}

export interface WSJoinMessage extends WSMessage {
  type: 'join'
  lobby_code: string
  player_id: string
}

export interface WSPlayCardMessage extends WSMessage {
  type: 'play_card'
  card_id: string
  target_player_id: string
}

export interface WSStateUpdateMessage extends WSMessage {
  type: 'state_update'
  state: LobbyState
}

export interface WSErrorMessage extends WSMessage {
  type: 'error'
  message: string
  code?: string
}
