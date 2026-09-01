"use strict";

// L'ospite minimo: la versione piu piccola di storage-connector-service che
// serva a provare un connettore per intero.
//
// Non ha database, non ha autenticazione, non parla con nessun altro servizio.
// Non e una semplificazione per pigrizia: e la condizione perche un
// collaboratore faccia `npm start` e veda il proprio connettore girare. Un
// ospite che chiede Postgres e un ospite che non viene mai avviato.
//
// Cio che invece rispetta alla lettera sono le regole del contratto, perche
// sono la ragione per cui esiste:
//   * i connettori si scoprono leggendo la cartella, mai un elenco;
//   * si legge il manifesto, non il codice;
//   * le credenziali rinnovate si persistono una volta;
//   * getChanges(null) da il cursore, non l'archivio.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");

const RADICE = path.join(__dirname, "..");

// Le variabili stanno nel .env della radice, lo stesso che legge
// scripts/record.js. Nessun export a mano: e la prima cosa che si dimentica.
const fileEnv = path.join(RADICE, ".env");
if (fs.existsSync(fileEnv) && typeof process.loadEnvFile === "function") {
  try { process.loadEnvFile(fileEnv); } catch { /* gia caricato */ }
}

const { leggiRegistro } = require("./registry");
const { costruisci, persistiRinnovo } = require("./provider");
const { sincronizza, DESTINAZIONE } = require("./sync");
const stato = require("./state");
const { eseguiConformita } = require("./conformance");

const PORTA = Number(process.env.HOST_PORT || 5191);
const app = express();
app.use(express.json());

// Gli stati OAuth in attesa: legano la risposta del provider alla richiesta
// partita da qui. Senza, questa pagina accetterebbe un codice da chiunque.
const statiAttesi = new Map();

function trovaConnettore(dir) {
  return leggiRegistro().connettori.find((c) => c.dir === dir) || null;
}

// ── Registro ────────────────────────────────────────────────────────────────

app.get("/api/connectors", (_req, res) => {
  const { connettori, rifiutati } = leggiRegistro();
  res.json({
    data: connettori.map((c) => ({
      ...c,
      connessione: (() => {
        const s = stato.connessione(c.dir);
        return {
          autorizzato: Boolean(s?.credentials?.access_token),
          haRefresh: Boolean(s?.credentials?.refresh_token),
          folderId: s?.folderId ?? null,
          cursore: s?.cursor ?? null,
          ultimaSync: s?.ultimaSync ?? null,
        };
      })(),
    })),
    rifiutati,
  });
});

// ── Conformita, sulle risposte registrate ───────────────────────────────────

app.post("/api/connectors/:dir/test", async (req, res) => {
  const c = trovaConnettore(req.params.dir);
  if (!c) return res.status(404).json({ error: "Connettore sconosciuto." });
  res.json({ data: await eseguiConformita(c.dir) });
});

// ── Autorizzazione ──────────────────────────────────────────────────────────

app.get("/api/connectors/:dir/auth-url", (req, res) => {
  const c = trovaConnettore(req.params.dir);
  if (!c) return res.status(404).json({ error: "Connettore sconosciuto." });
  if (!c.abilitato) {
    return res.status(409).json({ error: `Configurazione incompleta: ${c.configMancante.join(", ")}. Vanno nel .env della radice.` });
  }
  try {
    const { provider } = costruisci(c.dir);
    const chiave = crypto.randomBytes(16).toString("hex");
    statiAttesi.set(chiave, c.dir);
    res.json({ data: { url: provider.getAuthUrl(chiave), redirectPath: c.redirectPath } });
  } catch (errore) {
    res.status(400).json({ error: errore?.message || String(errore) });
  }
});

// Il ritorno dal provider. Il percorso lo dichiara il manifesto, quindi non e
// uno solo: si cerca quale connettore lo rivendica.
app.get(/^\/oauth\/.+/, async (req, res) => {
  const c = leggiRegistro().connettori.find((x) => x.redirectPath === req.path);
  const pagina = (titolo, corpo) => res.type("html").send(
    `<!doctype html><meta charset="utf-8"><title>${titolo}</title>`
    + `<body style="font:15px/1.6 system-ui;max-width:44rem;margin:4rem auto;padding:0 1rem;color:#253f3a">`
    + corpo + `<p><a href="/">Torna alla pagina</a></p></body>`);

  if (!c) return res.status(404).type("html").send("Nessun connettore dichiara questo percorso di ritorno.");
  if (req.query.error) return pagina("Autorizzazione rifiutata", `<h1>Autorizzazione rifiutata</h1><p>Il provider ha risposto <code>${req.query.error}</code>.</p>`);

  const chiave = String(req.query.state || "");
  if (!req.query.code || statiAttesi.get(chiave) !== c.dir) {
    return pagina("Richiesta non riconosciuta",
      "<h1>Richiesta non riconosciuta</h1><p>Manca il codice, oppure lo stato non corrisponde a nessuna autorizzazione avviata da qui.</p>");
  }
  statiAttesi.delete(chiave);

  try {
    const { provider } = costruisci(c.dir);
    const credenziali = await provider.exchangeCode(String(req.query.code));
    stato.salvaConnessione(c.dir, { credentials: credenziali || {} });
    return pagina("Autorizzato", `<h1>Autorizzato</h1><p><strong>${c.label}</strong> ha rilasciato le credenziali.`
      + (credenziali?.refresh_token
        ? " Con refresh token."
        : " <em>Senza</em> refresh token: la connessione morira alla scadenza, in silenzio. E uno dei tre errori che il contratto esiste per prevenire.")
      + `</p>`);
  } catch (errore) {
    return pagina("Scambio non riuscito", `<h1>Scambio non riuscito</h1><p>${String(errore?.message || errore)}</p>`);
  }
});

app.delete("/api/connectors/:dir/connection", (req, res) => {
  stato.dimenticaConnessione(req.params.dir);
  res.json({ data: { dimenticata: true } });
});

// ── Connessione viva ────────────────────────────────────────────────────────

app.post("/api/connectors/:dir/live", async (req, res) => {
  const c = trovaConnettore(req.params.dir);
  if (!c) return res.status(404).json({ error: "Connettore sconosciuto." });
  if (!c.abilitato) return res.status(409).json({ error: `Configurazione incompleta: ${c.configMancante.join(", ")}.` });
  if (!stato.connessione(c.dir)?.credentials?.access_token) {
    return res.status(409).json({ error: "Nessuna credenziale: autorizza il connettore." });
  }

  const inizio = Date.now();
  const passi = [];
  const { provider } = costruisci(c.dir);
  try {
    // Due chiamate e non una: testConnection puo passare con permessi
    // insufficienti a leggere, e un elenco vuoto si scopre solo chiedendolo.
    const esito = await provider.testConnection();
    passi.push({ nome: "testConnection", ok: true, dettaglio: JSON.stringify(esito ?? null).slice(0, 300) });
    const cartelle = await provider.listFolders(null);
    passi.push({ nome: "listFolders(null)", ok: true, dettaglio: `${(cartelle || []).length} cartelle` });
    persistiRinnovo(c.dir, provider);
    res.json({ data: { ok: true, passi, durata: Date.now() - inizio } });
  } catch (errore) {
    persistiRinnovo(c.dir, provider);
    passi.push({ nome: passi.length ? "listFolders(null)" : "testConnection", ok: false, dettaglio: errore?.message || String(errore) });
    res.json({ data: { ok: false, passi, durata: Date.now() - inizio } });
  }
});

// ── Cartelle e sincronizzazione ─────────────────────────────────────────────

app.get("/api/connectors/:dir/folders", async (req, res) => {
  const c = trovaConnettore(req.params.dir);
  if (!c) return res.status(404).json({ error: "Connettore sconosciuto." });
  try {
    const { provider } = costruisci(c.dir);
    const cartelle = await provider.listFolders(req.query.parentId ? String(req.query.parentId) : null);
    persistiRinnovo(c.dir, provider);
    res.json({ data: cartelle || [] });
  } catch (errore) {
    res.status(502).json({ error: errore?.message || String(errore) });
  }
});

app.post("/api/connectors/:dir/sync", async (req, res) => {
  const c = trovaConnettore(req.params.dir);
  if (!c) return res.status(404).json({ error: "Connettore sconosciuto." });
  const folderId = req.body?.folderId ?? stato.connessione(c.dir)?.folderId ?? null;
  if (folderId === null || folderId === undefined) {
    return res.status(400).json({ error: "Scegli prima una cartella da monitorare." });
  }
  res.json({ data: await sincronizza(c.dir, { folderId }) });
});

// Ricomincia da capo: dimentica il cursore e i file scaricati. Serve a
// riprovare la prima sincronizzazione senza rifare l'autorizzazione.
app.post("/api/connectors/:dir/reset", (req, res) => {
  const corrente = stato.connessione(req.params.dir) || {};
  stato.salvaConnessione(req.params.dir, { cursor: null, folderId: corrente.folderId ?? null });
  const cartella = path.join(DESTINAZIONE, req.params.dir);
  if (fs.existsSync(cartella)) fs.rmSync(cartella, { recursive: true, force: true });
  res.json({ data: { azzerato: true } });
});

// La pagina costruita, se c'e: cosi `npm run build && npm start` e un processo
// solo. In sviluppo ci si arriva dal dev server di Vite, che fa da proxy.
const dist = path.join(RADICE, "web", "dist");
if (fs.existsSync(dist)) app.use(express.static(dist));

app.listen(PORTA, () => {
  const { connettori, rifiutati } = leggiRegistro();
  console.log(`storage-connector-host su http://localhost:${PORTA}`);
  for (const c of connettori) {
    console.log(`  ${c.key}${c.abilitato ? "" : `  spento — manca ${c.configMancante.join(", ")}`}`);
  }
  for (const r of rifiutati) console.log(`  ${r.dir}  RIFIUTATO — ${r.motivo}`);
  if (!fs.existsSync(dist)) console.log("  (web/dist assente: usa il dev server di Vite in web/)");
});
