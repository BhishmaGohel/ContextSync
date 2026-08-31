import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function copyStaticAssets(): Plugin {
  return {
    name: 'copy-static-assets',
    apply: 'build',
    closeBundle() {
      const files = ['manifest.json', 'background.js', 'styles.css'];
      for (const file of files) {
        const src = path.resolve(__dirname, file);
        const dest = path.resolve(__dirname, 'dist', file);
        if (fs.existsSync(src)) {
          if (file === 'manifest.json') {
            const manifest = JSON.parse(fs.readFileSync(src, 'utf8')) as Record<string, unknown>;
            (manifest.background as Record<string, string>).service_worker = 'background.js';
            (manifest.action as Record<string, string>).default_popup = 'popup.html';
            (manifest.content_scripts as Array<Record<string, unknown>>).forEach((script) => {
              script.js = ['content.js'];
            });
            manifest.options_page = 'dashboard.html';
            fs.writeFileSync(dest, `${JSON.stringify(manifest, null, 2)}\n`);
          } else {
            fs.copyFileSync(src, dest);
          }
        }
      }
    }
  };
}

// Vite config for multiple entry points: popup, dashboard UI, and content script
export default defineConfig({
  root: '.',
  plugins: [react(), copyStaticAssets()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: path.resolve(__dirname, 'popup.html'),
        dashboard: path.resolve(__dirname, 'dashboard.html'),
        content: path.resolve(__dirname, 'src/content.ts')
      },
      output: {
        entryFileNames: (chunk) => {
          return chunk.name === 'content' ? 'content.js' : 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    }
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared')
    }
  }
});
