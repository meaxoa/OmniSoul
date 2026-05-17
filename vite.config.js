import { randomUUID } from 'node:crypto';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const VOLC_TTS_HEADERS = {
  'X-Api-App-Id': 'YOUR_VOLC_APP_ID',
  'X-Api-App-Key': 'YOUR_VOLC_APP_KEY',
  'X-Api-Access-Key': 'YOUR_VOLC_ACCESS_KEY',
  'X-Api-Resource-Id': 'seed-tts-2.0',
};

// Production note:
// Browsers can't set X-Api-* headers on a WebSocket upgrade, so the deploy target
// (nginx on omni-soul.geqian.site) must add them too. Add this to the site config:
//
//   location /api/volc-tts {
//     proxy_pass https://openspeech.bytedance.com/api/v3/tts/bidirection;
//     proxy_http_version 1.1;
//     proxy_set_header Upgrade $http_upgrade;
//     proxy_set_header Connection "Upgrade";
//     proxy_set_header Host openspeech.bytedance.com;
//     proxy_set_header X-Api-App-Id     "YOUR_VOLC_APP_ID";
//     proxy_set_header X-Api-App-Key    "YOUR_VOLC_APP_KEY";
//     proxy_set_header X-Api-Access-Key "YOUR_VOLC_ACCESS_KEY";
//     proxy_set_header X-Api-Resource-Id "seed-tts-2.0";
//     proxy_set_header X-Api-Connect-Id $request_id;
//     proxy_set_header X-Api-Request-Id $request_id;
//     proxy_read_timeout 600s;
//     proxy_send_timeout 600s;
//   }

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api/volc-tts': {
        target: 'wss://openspeech.bytedance.com',
        changeOrigin: true,
        ws: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/volc-tts/, '/api/v3/tts/bidirection'),
        headers: VOLC_TTS_HEADERS,
        configure: (proxy) => {
          proxy.on('proxyReqWs', (proxyReq) => {
            proxyReq.setHeader('X-Api-Connect-Id', randomUUID());
            proxyReq.setHeader('X-Api-Request-Id', randomUUID());
          });
        },
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
  },
});
