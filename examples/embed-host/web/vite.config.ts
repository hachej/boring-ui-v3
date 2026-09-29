import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({ plugins: [react()], build: { outDir: "dist", emptyOutDir: true }, server: { proxy: { "/agent": "http://localhost:8788", "/api": "http://localhost:8788" } } });
