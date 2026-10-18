import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, normalizePath, type Plugin } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

const src = (file: string) => normalizePath(path.resolve(import.meta.dirname, 'src', file))

/**
 * Remplace des modules de la GUI par leur équivalent autonome, quel que soit
 * le chemin relatif par lequel ils sont importés.
 */
function swapModules(replacements: Record<string, string>): Plugin {
  return {
    name: 'mcp-design-standalone-swap',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      return resolved ? (replacements[normalizePath(resolved.id)] ?? null) : null
    },
  }
}

/**
 * Version autonome : toute l'application dans un seul fichier HTML, ouvert
 * directement dans le navigateur, sans serveur. Les données vivent dans le
 * navigateur et s'échangent par fichiers JSON.
 */
export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [
    swapModules({
      [src('utils/api.ts')]: src('standalone/api.ts'),
      [src('hooks/useServerChanges.ts')]: src('standalone/useLocalChanges.ts'),
    }),
    react(),
    viteSingleFile(),
  ],
  resolve: {
    alias: {
      '@shared': path.resolve(import.meta.dirname, '../shared'),
      '@core': path.resolve(import.meta.dirname, '../src/core'),
    },
  },
  build: {
    outDir: 'dist-standalone',
    rollupOptions: { input: path.resolve(import.meta.dirname, 'mcp-design.html') },
  },
})
