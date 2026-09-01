import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// La pagina non ha piu un backend proprio: parla con l'ospite, che e lo stesso
// processo che un collaboratore avvia con `npm start` nella radice. Prima le
// rotte vivevano qui dentro, ed era comodo — ma insegnava che l'ospite e un
// dettaglio del dev server, mentre e il contrario: e l'ospite la cosa da
// imitare, e questa pagina e solo la sua interfaccia.
//
// /oauth passa dal proxy come /api: cosi il redirect registrato nella console
// del provider e uno solo, quello della pagina, e funziona sia in sviluppo sia
// quando l'ospite serve la pagina costruita.
const OSPITE = process.env.HOST_URL || "http://localhost:5191";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5190,
    proxy: {
      "/api": { target: OSPITE, changeOrigin: true },
      "/oauth": { target: OSPITE, changeOrigin: true },
    },
  },
});
