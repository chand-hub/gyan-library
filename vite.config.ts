import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

function isHmrEnabled(): boolean {
  if (process.env.DISABLE_HMR === 'true') return false;
  if (process.env.ENABLE_HMR === 'true') return true;
  const isCloudRunPreview =
    Boolean(process.env.K_SERVICE) || String(process.env.APP_URL || '').includes('.run.app');
  return !isCloudRunPreview;
}

export default defineConfig(() => {
  const hmrEnabled = isHmrEnabled();
  return {
    plugins: [
      react(),
      tailwindcss(),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // Disable HMR in AI Studio Cloud Run preview containers where WebSockets are not proxied.
      hmr: hmrEnabled,
      watch: hmrEnabled ? {} : null,
    },
  };
});
