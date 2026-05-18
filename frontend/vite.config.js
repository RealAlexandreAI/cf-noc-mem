import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // VITE_API_TARGET 指向后端 API 地址，默认 localhost:8234（开发环境）。
  // 生产环境（mode=production）可设为实际后端地址。
  const apiTarget = env.VITE_API_TARGET || 'http://127.0.0.1:8234'

  return {
    plugins: [react()],
    server: {
      port: 3000,
      proxy: {
        '/api': {
          // 避免 Windows 下优先解析 ::1 导致 IPv6 拒绝连接
          target: apiTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, '')
        }
      }
    }
  }
})
