/**
 * Vue Router configuration
 */

import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '@/views/HomeView.vue'
import LobbyView from '@/views/LobbyView.vue'
import GameView from '@/views/GameView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
      meta: {
        title: 'Trap Card Game',
      },
    },
    {
      path: '/lobby/:code',
      name: 'lobby',
      component: LobbyView,
      meta: {
        title: 'Lobby',
      },
    },
    {
      path: '/game/:code',
      name: 'game',
      component: GameView,
      meta: {
        title: 'Game',
      },
    },
  ],
})

// Update document title
router.beforeEach((to, _from, next) => {
  document.title = (to.meta.title as string) || 'Trap Card Game'
  next()
})

export default router
