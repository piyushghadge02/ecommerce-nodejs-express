import { createApp } from 'vue'
import App from './App.vue'
import router from './router/index.js'
import { initTheme } from './stores/theme.js'
import './assets/main.css'

initTheme()

const app = createApp(App)
app.use(router)
app.mount('#app')
