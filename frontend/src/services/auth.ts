/**
 * Authentication service for user login and registration
 */

import { config } from '@/config'

export interface AuthResponse {
  user_id: string
  username: string
  token: string
}

export interface AuthCredentials {
  username: string
  password: string
}

class AuthService {
  private baseUrl: string
  private tokenKey = 'trap_card_auth_token'

  constructor() {
    this.baseUrl = config.api.baseUrl
  }

  /**
   * Register a new user
   */
  async register(credentials: AuthCredentials): Promise<AuthResponse> {
    const response = await fetch(`${this.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(credentials),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(error.detail || 'Registration failed')
    }

    return response.json()
  }

  /**
   * Login a user
   */
  async login(credentials: AuthCredentials): Promise<AuthResponse> {
    const response = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(credentials),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(error.detail || 'Login failed')
    }

    return response.json()
  }

  /**
   * Validate current session
   */
  async validateSession(): Promise<AuthResponse> {
    const token = this.getToken()

    if (!token) {
      throw new Error('No token found')
    }

    const response = await fetch(`${this.baseUrl}/api/auth/me`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      this.clearToken()
      throw new Error('Session validation failed')
    }

    return response.json()
  }

  /**
   * Save token to localStorage
   */
  saveToken(token: string): void {
    try {
      localStorage.setItem(this.tokenKey, token)
    } catch (err) {
      console.error('Failed to save token:', err)
    }
  }

  /**
   * Get token from localStorage
   */
  getToken(): string | null {
    try {
      return localStorage.getItem(this.tokenKey)
    } catch (err) {
      console.error('Failed to get token:', err)
      return null
    }
  }

  /**
   * Clear token from localStorage
   */
  clearToken(): void {
    try {
      localStorage.removeItem(this.tokenKey)
    } catch (err) {
      console.error('Failed to clear token:', err)
    }
  }

  /**
   * Get authorization header for API requests
   */
  getAuthHeader(): Record<string, string> {
    const token = this.getToken()
    if (!token) {
      return {}
    }
    return {
      'Authorization': `Bearer ${token}`,
    }
  }
}

// Export singleton instance
export const authService = new AuthService()
