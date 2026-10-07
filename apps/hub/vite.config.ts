import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// O Hub é estático (ADR-0025): o `vite build` gera `dist/`, que o nginx
// serve no mesmo anfitrião da API (docs/22 §2). Em desenvolvimento, o
// `/hub/*` vai para a API local.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", sourcemap: false },
  server: { proxy: { "/hub": "http://127.0.0.1:8080" } },
});
