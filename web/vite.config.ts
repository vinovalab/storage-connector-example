import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import path from "node:path";

const RADICE = path.resolve(__dirname, "..");
const CONNETTORI = path.join(RADICE, "connectors");
const require_ = createRequire(import.meta.url);

// A connector is a Node module: the browser cannot run it. These two endpoints
// live in the dev server so the page stays a page — no second process to start,
// no build step, no login.
//
// The test runs the connector's own conformance suite, the same one `npm test`
// runs. Reimplementing the checks here would mean two definitions of "working"
// that drift apart; running the real suite means the button and CI can never
// disagree.

type Manifest = {
  key: string; label: string; description?: string;
  contractVersion?: string;
  capabilities?: Record<string, boolean>;
  config?: Array<{ key: string; required?: boolean; secret?: boolean; description?: string }>;
  auth?: { kind?: string };
};

function elencaConnettori() {
  if (!existsSync(CONNETTORI)) return [];
  return readdirSync(CONNETTORI, { withFileTypes: true })
    .filter((voce) => voce.isDirectory())
    .map((voce) => {
      const cartella = voce.name;
      const percorso = path.join(CONNETTORI, cartella, "manifest.js");
      if (!existsSync(percorso)) return null;
      try {
        // Fresh read at every request: a connector being written changes under
        // your hands, and a cached manifest would show yesterday's shape.
        delete require_.cache[require_.resolve(percorso)];
        const manifest = require_(percorso) as Manifest;
        return {
          dir: cartella,
          key: manifest.key,
          label: manifest.label,
          description: manifest.description ?? null,
          contractVersion: manifest.contractVersion ?? null,
          authKind: manifest.auth?.kind ?? null,
          capabilities: manifest.capabilities ?? {},
          config: (manifest.config ?? []).map((c) => ({
            key: c.key, required: Boolean(c.required), secret: Boolean(c.secret),
            description: c.description ?? null,
          })),
          hasSuite: existsSync(path.join(CONNETTORI, cartella, "conformance.test.js")),
          hasFixtures: existsSync(path.join(CONNETTORI, cartella, "fixtures")),
        };
      } catch (errore) {
        // A manifest that does not load is the first thing to fix, and it must
        // be visible on the page instead of making the list disappear.
        return {
          dir: cartella, key: cartella.toUpperCase(), label: cartella,
          description: null, contractVersion: null, authKind: null,
          capabilities: {}, config: [], hasSuite: false, hasFixtures: false,
          error: errore instanceof Error ? errore.message : String(errore),
        };
      }
    })
    .filter(Boolean);
}

function eseguiSuite(cartella: string) {
  const file = path.join("connectors", cartella, "conformance.test.js");
  return new Promise<{ ok: boolean; pass: number; fail: number; durata: number; output: string }>((resolve) => {
    const inizio = Date.now();
    execFile("node", ["--test", file], { cwd: RADICE, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
      (errore, stdout, stderr) => {
        const output = `${stdout}${stderr}`;
        const numero = (etichetta: string) => {
          const trovato = output.match(new RegExp(`^# ${etichetta} (\\d+)$`, "m"));
          return trovato ? Number(trovato[1]) : 0;
        };
        const fail = numero("fail");
        resolve({
          // Il codice di uscita e l'autorita: un conteggio a zero puo anche
          // voler dire che la suite non e partita affatto.
          ok: !errore && fail === 0,
          pass: numero("pass"),
          fail,
          durata: Date.now() - inizio,
          output: output.trim(),
        });
      });
  });
}

function apiConnettori(): Plugin {
  return {
    name: "connector-test-api",
    configureServer(server) {
      server.middlewares.use("/api/connectors", async (req, res) => {
        const url = new URL(req.url || "/", "http://localhost");
        const rispondi = (stato: number, corpo: unknown) => {
          res.statusCode = stato;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(corpo));
        };

        if (req.method === "GET" && (url.pathname === "/" || url.pathname === "")) {
          return rispondi(200, { data: elencaConnettori() });
        }

        const prova = url.pathname.match(/^\/([^/]+)\/test$/);
        if (req.method === "POST" && prova) {
          const cartella = decodeURIComponent(prova[1]);
          // Solo cartelle esistenti sotto connectors/: il nome arriva dalla
          // rete e finisce in una riga di comando.
          const ammesse = new Set(elencaConnettori().map((c: any) => c.dir));
          if (!ammesse.has(cartella)) return rispondi(404, { error: "Unknown connector." });
          return rispondi(200, { data: await eseguiSuite(cartella) });
        }

        return rispondi(404, { error: "Not found." });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), apiConnettori()],
  server: { host: "0.0.0.0", port: 5190 },
});
