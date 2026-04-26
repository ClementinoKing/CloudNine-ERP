import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  worker: {
    format: 'es',
  },
  build: {
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/src/features/dashboard/pages/my-tasks-page')) return 'page-my-tasks'
          if (id.includes('/src/features/dashboard/pages/project-detail-page')) return 'page-project-detail'
          if (id.includes('/src/features/tasks/components/universal-task-details-modal')) return 'task-modal'
          if (id.includes('/src/components/ui/mention-rich-text-editor')) return 'mention-editor'

          if (!id.includes('node_modules')) return

          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('/scheduler/') ||
            id.includes('/react-router/') ||
            id.includes('/react-router-dom/')
          ) {
            return 'react-core'
          }
          if (id.includes('@radix-ui')) return 'radix'
          if (id.includes('react-hook-form') || id.includes('@hookform') || id.includes('zod')) return 'forms'
          if (id.includes('lucide-react') || id.includes('react-icons')) return 'icons'
          if (id.includes('date-fns') || id.includes('react-day-picker')) return 'dates'
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
