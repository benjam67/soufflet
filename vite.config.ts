import { defineConfig } from 'vite';

// Le site est servi par GitHub Pages sous https://benjam67.github.io/soufflet/
export default defineConfig({
  base: '/soufflet/',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        // Phaser dans un fichier à part : mis en cache d'une version à l'autre.
        manualChunks: (id: string) => (id.includes('node_modules/phaser') ? 'phaser' : undefined),
      },
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
  },
});
