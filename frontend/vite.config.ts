import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// During development, requests to /api are forwarded to the backend,
// so the browser never has CORS problems and no URL needs configuring.
const apiProxy = {
  "/api": { target: process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:4000", changeOrigin: true },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: apiProxy },
  preview: { port: 4173, proxy: apiProxy },
});
