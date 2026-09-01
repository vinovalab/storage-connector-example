import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The page no longer has a backend of its own: it talks to the host, the same
// process a collaborator starts with `npm start` in the root. The routes used to
// live in here, which was convenient — but it taught that the host is a detail
// of the dev server, when it is the other way round: the host is the thing to
// imitate, and this page is only its interface.
//
// /oauth goes through the proxy like /api, so the redirect registered in the
// provider's console is a single one — the page's — and it works both in
// development and when the host serves the built page.
const HOST = process.env.HOST_URL || "http://localhost:5191";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5190,
    proxy: {
      "/api": { target: HOST, changeOrigin: true },
      "/oauth": { target: HOST, changeOrigin: true },
    },
  },
});
