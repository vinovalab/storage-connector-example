import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

const RADICE = path.resolve(__dirname, "..");
const CONNETTORI = path.join(RADICE, "connectors");
const require_ = createRequire(import.meta.url);
// I moduli dei connettori e le loro dipendenze vivono nella radice del
// repository, non qui: axios e @vinovalab/storage-connector-contract sono
// dichiarati la. Risolvere da web/ funzionerebbe per risalita, ma solo finche
// nessuno installa una versione diversa qui dentro.
const require_radice = createRequire(path.join(RADICE, "package.json"));

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

// ── Prove reali ─────────────────────────────────────────────────────────────
//
// Tutto quello sopra gira su risposte registrate: fixtureTransport importa solo
// fs, path e crypto, quindi non ha alcuna capacita di rete. E il progetto del
// contratto, e serve a verificare un connettore senza account.
//
// Quello che segue e l'altra meta, e non la sostituisce: parla davvero con il
// provider. Serve a rispondere a una domanda diversa — "le credenziali che ho
// funzionano, e il giro di OAuth si chiude?" — che le fixture per costruzione
// non possono verificare.

// Le credenziali ottenute dall'autorizzazione restano in memoria, per la durata
// del processo. Non finiscono su disco: sono token vivi, e un file scritto da
// uno strumento di sviluppo e il modo piu semplice per ritrovarseli in un
// commit.
const credenziali = new Map<string, Record<string, unknown>>();
const statiAttesi = new Map<string, string>();

function caricaAmbiente() {
  const file = path.join(RADICE, ".env");
  if (!existsSync(file)) return;
  if (typeof (process as any).loadEnvFile === "function") {
    try { (process as any).loadEnvFile(file); } catch { /* gia caricato */ }
  }
}

function costruisciProvider(cartella: string, manifest: Manifest) {
  const base = path.join(CONNETTORI, cartella);
  delete require_radice.cache[require_radice.resolve(path.join(base, "provider.js"))];
  const Provider = require_radice(path.join(base, "provider.js"));

  const env: Record<string, string | undefined> = {};
  for (const voce of manifest.config ?? []) env[voce.key] = process.env[voce.key];
  const mancanti = (manifest.config ?? [])
    .filter((voce) => voce.required && !env[voce.key])
    .map((voce) => voce.key);

  // Lo stesso client di scripts/record.js: axios sagomato come il contratto si
  // aspetta, con gli stati di errore che rifiutano portandosi dietro la
  // risposta.
  let axios;
  try {
    axios = require_radice("axios");
  } catch {
    throw new Error("axios non installato nella radice del repository: esegui `npm install` li, non solo in web/.");
  }
  const http = async (config: any) => axios({ ...config, validateStatus: () => true, timeout: 30_000 })
    .then((r: any) => {
      if (r.status >= 400) {
        const err: any = new Error(`Request failed with status ${r.status}`);
        err.status = r.status;
        err.response = r;
        throw err;
      }
      return r;
    });

  const salvate = credenziali.get(cartella);
  const provider = new Provider({
    credentials: salvate ?? {
      access_token: process.env.CONNECTOR_ACCESS_TOKEN || "",
      refresh_token: process.env.CONNECTOR_REFRESH_TOKEN || "",
    },
    env,
    http,
    logger: { info() {}, warning() {}, error() {} },
  });

  return {
    provider,
    mancanti,
    origineCredenziali: salvate ? "autorizzazione" : "ambiente",
    haCredenziali: Boolean(salvate?.access_token || process.env.CONNECTOR_ACCESS_TOKEN),
  };
}

async function provaLive(cartella: string, manifest: Manifest) {
  caricaAmbiente();
  const inizio = Date.now();
  try {
    const { provider, mancanti, origineCredenziali, haCredenziali } = costruisciProvider(cartella, manifest);
    if (mancanti.length) {
      return { ok: false, passi: [], durata: Date.now() - inizio, origineCredenziali,
        errore: `Variabili mancanti in .env: ${mancanti.join(", ")}` };
    }
    if (!haCredenziali) {
      return { ok: false, passi: [], durata: Date.now() - inizio, origineCredenziali,
        errore: "Nessuna credenziale: autorizza il connettore, oppure metti CONNECTOR_ACCESS_TOKEN in .env." };
    }

    const passi: Array<{ nome: string; ok: boolean; dettaglio: string }> = [];
    // Due chiamate e non una: testConnection puo passare anche con permessi
    // insufficienti a leggere, e un elenco vuoto lo si scopre solo chiedendolo.
    try {
      const esito = await provider.testConnection();
      passi.push({ nome: "testConnection", ok: true, dettaglio: JSON.stringify(esito ?? null).slice(0, 300) });
    } catch (errore: any) {
      passi.push({ nome: "testConnection", ok: false, dettaglio: errore?.message || String(errore) });
      return { ok: false, passi, durata: Date.now() - inizio, origineCredenziali };
    }
    try {
      const cartelle = await provider.listFolders(null);
      passi.push({ nome: "listFolders(null)", ok: true, dettaglio: `${(cartelle || []).length} cartelle` });
    } catch (errore: any) {
      passi.push({ nome: "listFolders(null)", ok: false, dettaglio: errore?.message || String(errore) });
      return { ok: false, passi, durata: Date.now() - inizio, origineCredenziali };
    }

    return { ok: true, passi, durata: Date.now() - inizio, origineCredenziali };
  } catch (errore: any) {
    return { ok: false, passi: [], durata: Date.now() - inizio,
      errore: errore?.message || String(errore), origineCredenziali: "ambiente" };
  }
}

function urlAutorizzazione(cartella: string, manifest: Manifest, host: string) {
  caricaAmbiente();
  const { provider, mancanti } = costruisciProvider(cartella, manifest);
  if (mancanti.length) throw new Error(`Variabili mancanti in .env: ${mancanti.join(", ")}`);

  const stato = randomBytes(16).toString("hex");
  statiAttesi.set(stato, cartella);
  return {
    url: provider.getAuthUrl(stato),
    // L'indirizzo che il provider deve conoscere. Se non combacia con quello
    // registrato nella console, l'autorizzazione fallisce dopo il consenso —
    // il momento peggiore per scoprirlo.
    redirectAtteso: `${host}${manifest.auth?.redirectPath ?? "/oauth/callback"}`,
    redirectConfigurato: process.env[(manifest.config ?? []).find((c) => /REDIRECT/i.test(c.key))?.key ?? ""] ?? null,
  };
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

        const elenco = elencaConnettori() as any[];
        const cercaConnettore = (nome: string) => elenco.find((c) => c.dir === nome);

        // Prova reale: parla davvero con il provider, con le credenziali
        // ottenute dall'autorizzazione o messe in .env.
        const live = url.pathname.match(/^\/([^/]+)\/live$/);
        if (req.method === "POST" && live) {
          const cartella = decodeURIComponent(live[1]);
          const voce = cercaConnettore(cartella);
          if (!voce) return rispondi(404, { error: "Unknown connector." });
          const manifest = require_(path.join(CONNETTORI, cartella, "manifest.js"));
          return rispondi(200, { data: await provaLive(cartella, manifest) });
        }

        // L'indirizzo a cui mandare l'utente per autorizzare.
        const autorizza = url.pathname.match(/^\/([^/]+)\/auth-url$/);
        if (req.method === "GET" && autorizza) {
          const cartella = decodeURIComponent(autorizza[1]);
          const voce = cercaConnettore(cartella);
          if (!voce) return rispondi(404, { error: "Unknown connector." });
          try {
            const manifest = require_(path.join(CONNETTORI, cartella, "manifest.js"));
            const host = `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}`;
            return rispondi(200, { data: urlAutorizzazione(cartella, manifest, host) });
          } catch (errore: any) {
            return rispondi(400, { error: errore?.message || String(errore) });
          }
        }

        // Stato delle credenziali in memoria, per sapere cosa mostrare.
        const stato = url.pathname.match(/^\/([^/]+)\/credentials$/);
        if (req.method === "GET" && stato) {
          const cartella = decodeURIComponent(stato[1]);
          const salvate = credenziali.get(cartella);
          return rispondi(200, { data: {
            autorizzato: Boolean(salvate),
            // Mai il valore: solo che c'e e da quando.
            scadenza: salvate?.expires_at ?? null,
            haRefresh: Boolean(salvate?.refresh_token),
          } });
        }

        return rispondi(404, { error: "Not found." });
      });

      // Il ritorno dall'autorizzazione. Il percorso lo dichiara il manifest —
      // /oauth/dropbox/callback — quindi non e uno solo e non si puo montare
      // sotto un prefisso fisso: si cerca quale connettore lo rivendica.
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || "/", "http://localhost");
        const connettore = (elencaConnettori() as any[]).find((c) => {
          try {
            const m = require_(path.join(CONNETTORI, c.dir, "manifest.js"));
            return m?.auth?.redirectPath && m.auth.redirectPath === url.pathname;
          } catch { return false; }
        });
        if (!connettore) return next();

        const pagina = (titolo: string, corpo: string) => {
          res.statusCode = 200;
          res.setHeader("content-type", "text/html; charset=utf-8");
          res.end(`<!doctype html><meta charset="utf-8"><title>${titolo}</title>`
            + `<body style="font:15px/1.6 system-ui;max-width:46rem;margin:4rem auto;padding:0 1rem;color:#253f3a">`
            + corpo + `<p><a href="/">Torna alla pagina</a></p></body>`);
        };

        const errore = url.searchParams.get("error");
        if (errore) {
          return pagina("Autorizzazione rifiutata",
            `<h1>Autorizzazione rifiutata</h1><p>Il provider ha risposto <code>${errore}</code>.</p>`);
        }

        const code = url.searchParams.get("code");
        const statoRicevuto = url.searchParams.get("state") || "";
        // Lo stato lega la risposta alla richiesta: senza, questa pagina
        // accetterebbe un codice arrivato da chiunque.
        if (!code || statoRicevuto !== "" && statiAttesi.get(statoRicevuto) !== connettore.dir) {
          return pagina("Richiesta non riconosciuta",
            "<h1>Richiesta non riconosciuta</h1><p>Manca il codice, oppure lo stato non corrisponde a nessuna autorizzazione avviata da qui.</p>");
        }
        statiAttesi.delete(statoRicevuto);

        try {
          caricaAmbiente();
          const manifest = require_(path.join(CONNETTORI, connettore.dir, "manifest.js"));
          const { provider } = costruisciProvider(connettore.dir, manifest);
          const ottenute = await provider.exchangeCode(code);
          credenziali.set(connettore.dir, ottenute || {});
          return pagina("Autorizzato", `<h1>Autorizzato</h1>`
            + `<p><strong>${connettore.label}</strong> ha rilasciato le credenziali.`
            + (ottenute?.refresh_token ? " Con refresh token." : " <em>Senza</em> refresh token: la connessione morira alla scadenza.")
            + `</p><p>Restano in memoria di questo processo e non vengono scritte su disco.</p>`);
        } catch (e: any) {
          return pagina("Scambio non riuscito",
            `<h1>Scambio non riuscito</h1><p>${String(e?.message || e)}</p>`);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), apiConnettori()],
  server: { host: "0.0.0.0", port: 5190 },
});
