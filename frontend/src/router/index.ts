/**
 * Vue Router configuration
 */

import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import HomeView from '@/views/HomeView.vue'
import LoginView from '@/views/LoginView.vue'
import LobbyView from '@/views/LobbyView.vue'
import GameView from '@/views/GameView.vue'

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    requiresAuth?: boolean
  }
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: LoginView,
      meta: {
        title: 'Login',
        requiresAuth: false,
      },
    },
    {
      path: '/',
      name: 'home',
      component: HomeView,
      meta: {
        title: 'Trap Card Game',
        requiresAuth: true,
      },
    },
    {
      path: '/lobby/:code',
      name: 'lobby',
      component: LobbyView,
      meta: {
        title: 'Lobby',
        requiresAuth: true,
      },
    },
    {
      path: '/game/:code',
      name: 'game',
      component: GameView,
      meta: {
        title: 'Game',
        requiresAuth: true,
      },
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: () => ({ name: 'login' }),
    },
  ],
})

// Track if we've completed initial auth restore
let initialAuthCheckDone = false

// Update document title and handle authentication
router.beforeEach(async (to, _from, next) => {
  document.title = (to.meta.title as string) || 'Trap Card Game'

  const authStore = useAuthStore()
  const requiresAuth = to.meta.requiresAuth !== false // Default to requiring auth

  // On first navigation, ensure auth store is ready
  if (!initialAuthCheckDone && authStore.loading) {
    // Wait for auth restoration to complete
    await new Promise((resolve) => {
      const checkAuth = setInterval(() => {
        if (!authStore.loading) {
          clearInterval(checkAuth)
          initialAuthCheckDone = true
          resolve(null)
        }
      }, 50)
    })
  }

  // Now that auth is ready, make routing decision
  const isAuthenticated = authStore.isAuthenticated

  // If route requires auth and user is not authenticated
  if (requiresAuth && !isAuthenticated) {
    // Redirect to login
    next({ name: 'login' })
  }
  // If user is authenticated and trying to access login page
  else if (to.name === 'login' && isAuthenticated) {
    // Redirect to home
    next({ name: 'home' })
  } else {
    next()
  }
})

export default router
