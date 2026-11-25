import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import themeColors from './scripts/themeColors.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  css: { postcss: { plugins: [themeColors()] } },
})
