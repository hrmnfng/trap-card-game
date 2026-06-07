import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import { useAuthStore } from './stores/auth'
import App from './App.vue'
import './style.css'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)

// Restore session before allowing router navigation
const authStore = useAuthStore()
authStore.restoreSession().then(() => {
  // Session restore completed (or failed), now safe to navigate
  app.mount('#app')
}).catch((err) => {
  // Even if restore fails, mount the app (user will see login page)
  console.error('Failed to restore session:', err)
  app.mount('#app')
})
