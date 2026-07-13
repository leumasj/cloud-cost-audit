import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // Object-form manualChunks is no longer supported by Vite 8's Rolldown
    // bundler; codeSplitting.groups is the replacement. See:
    // https://rolldown.rs/in-depth/manual-code-splitting
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { test: /node_modules\/react(-dom)?\//, name: 'react-vendor' },
          ],
        },
      },
    },
    chunkSizeWarningLimit: 500,
  }
})
