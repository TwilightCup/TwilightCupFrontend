import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// 后端地址：开发环境下通过 Vite 代理同源访问，规避浏览器 CORS。
// 如需指向其它机器上的后端，改这里即可（或改 .env 的 VITE_BACKEND_URL 走直连）。
const BACKEND_TARGET = process.env.TWILIGHT_BACKEND ?? "http://localhost:8000";

// Vite 6 默认拒绝非本机 Host 头（防 DNS rebinding）。暴露到公网 / 自定义域名时需放行：
//   设 TWILIGHT_ALLOWED_HOST=你的域名 → 仅允许该域名（推荐）
//   不设 → true 全放行（仅限受控的开发环境）
const ALLOWED_HOSTS: true | string[] = process.env.TWILIGHT_ALLOWED_HOST
  ? [process.env.TWILIGHT_ALLOWED_HOST]
  : true;

// Chrome 142+ 的 Local Network Access 默认不允许跨域 iframe 访问本地网络；
// 导播页需要给 YouTube 嵌入页放行该权限，避免“公共页面连接本地网络被阻止”。
const LNA_HEADERS = {
  "Permissions-Policy": "local-network=*, local-network-access=*",
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5173,
    allowedHosts: ALLOWED_HOSTS,
    headers: LNA_HEADERS,
    proxy: {
      // REST：浏览器请求 /api/...，代理去掉 /api 前缀后转发给后端
      "/api": {
        target: BACKEND_TARGET,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
      // WebSocket：浏览器请求 /ws/...，代理透传给后端
      "/ws": {
        target: BACKEND_TARGET,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  preview: {
    host: true,
    port: 4173,
    allowedHosts: ALLOWED_HOSTS,
    headers: LNA_HEADERS,
  },
  build: {
    // 构建产物放 static/：默认的 assets/ 会与对象存储反代路径 /assets/ 冲突
    assetsDir: "static",
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        // 导播场景页（合成器浪潮全屏画面，各自一个独立链接）
        categoryinfo: fileURLToPath(new URL("./categoryinfo.html", import.meta.url)),
        bracket: fileURLToPath(new URL("./bracket.html", import.meta.url)),
        mappool: fileURLToPath(new URL("./mappool.html", import.meta.url)),
        match: fileURLToPath(new URL("./match-scene.html", import.meta.url)),
        // 合并舞台：单 OBS 源承载全部场景，导播控制台经 localStorage 切换
        stage: fileURLToPath(new URL("./stage.html", import.meta.url)),
      },
    },
  },
});
