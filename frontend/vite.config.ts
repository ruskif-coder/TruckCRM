import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    // Поднимаем порог — после разделения app-чанк ~350 kB, что нормально при gzip ~100 kB
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          // React-ядро в отдельный чанк — браузер кеширует между деплоями
          vendor: ["react", "react-dom", "react-router-dom"],
        },
      },
    },
  },
});
