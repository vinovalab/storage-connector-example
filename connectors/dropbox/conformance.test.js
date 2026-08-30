"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const {
  registerConformanceTests,
  createReplayTransport,
} = require("@vinovalab/storage-connector-contract");

const DropboxProvider = require("./provider");
const manifest = require("./manifest");
const scenario = require("./scenario");

// L'account di prova non serve: le risposte sono registrate. E' cio che rende
// questa verifica ripetibile in CI, sul portatile di chi revisiona, e fra sei
// mesi quando l'account non esistera piu.

const ENV = {
  DROPBOX_APP_KEY: "app-key",
  DROPBOX_APP_SECRET: "app-secret",
  DROPBOX_REDIRECT_URI: "https://example.test/oauth/dropbox/callback",
};

const CREDENZIALI = {
  access_token: "token-valido",
  refresh_token: "r-1",
  expires_at: Date.now() + 3600_000,
};

const creaProvider = (credenziali = CREDENZIALI) => new DropboxProvider({
  credentials: { ...credenziali },
  env: ENV,
  http: createReplayTransport({ dir: path.join(__dirname, "fixtures") }),
  logger: { info() {}, warning() {}, error() {} },
});

registerConformanceTests(test, { createProvider: () => creaProvider(), manifest, scenario });

// ── oltre la conformita: cio che e specifico di Dropbox ──────────────────

test("[invariante] la radice e la stringa vuota, non «/»", async () => {
  // E' l'unico posto in cui le due cose si distinguono: `path: "/"` produce un
  // 400 sulla prima chiamata, e l'errore di Dropbox non spiega perche.
  const cartelle = await creaProvider().listFolders("/");
  assert.deepEqual(cartelle.map((c) => c.id), ["/documenti"]);
});

test("[invariante] l'identificatore e il percorso in minuscolo", async () => {
  // L'host lo salva e lo restituisce al connettore per scaricare: se cambiasse
  // fra una sincronizzazione e l'altra — maiuscole comprese — ogni file
  // risulterebbe nuovo e l'archivio si duplicherebbe.
  const file = await creaProvider().listFiles("/Documenti");
  assert.ok(file.every((f) => f.id === f.id.toLowerCase()));
  assert.equal(file[0].pathDisplay, "/Documenti/relazione.pdf", "il nome per gli umani conserva le maiuscole");
});

test("[invariante] un file non scaricabile non entra nell'elenco", async () => {
  // Dropbox marca cosi i file dei Paper e gli spazi condivisi non montati:
  // elencarli produrrebbe download falliti a ogni giro, per sempre.
  const provider = creaProvider();
  const originale = provider._chiama.bind(provider);
  provider._chiama = async (endpoint, corpo) => {
    const dati = await originale(endpoint, corpo);
    if (endpoint !== "/files/list_folder") return dati;
    return { ...dati, entries: [...dati.entries, { ".tag": "file", name: "paper.paper", path_lower: "/documenti/paper.paper", is_downloadable: false }] };
  };
  const file = await provider.listFiles("/Documenti");
  assert.equal(file.some((f) => f.id === "/documenti/paper.paper"), false);
});

test("[invariante] il mime si deduce dall'estensione, e cio che non si indicizza si vede", async () => {
  const file = await creaProvider().listFiles("/Documenti");
  const perId = Object.fromEntries(file.map((f) => [f.id, f]));
  assert.equal(perId["/documenti/relazione.pdf"].mimeType, "application/pdf");
  assert.equal(perId["/documenti/relazione.pdf"].isIndexable, true);
  assert.equal(perId["/documenti/immagine.png"].mimeType, "application/octet-stream",
    "Dropbox non dichiara il mime: senza estensione riconosciuta non si inventa");
  assert.equal(perId["/documenti/immagine.png"].isIndexable, false,
    "un'immagine non ha testo da estrarre: indicizzarla sarebbe lavoro sprecato a ogni giro");
});

test("[invariante] senza offline non arriva il refresh token", () => {
  // Dropbox consegna il refresh token **solo** se l'autorizzazione lo chiede.
  // Senza, la connessione funziona quattro ore e poi muore di notte.
  const url = new URL(creaProvider().getAuthUrl("stato-123"));
  assert.equal(url.searchParams.get("token_access_type"), "offline");
  assert.equal(url.searchParams.get("state"), "stato-123", "lo state torna indietro tale e quale, o la callback non sa a chi appartiene");
  assert.equal(url.searchParams.get("client_id"), "app-key");
});

test("[invariante] il token scaduto si rinnova prima della chiamata, non dopo il 401", async () => {
  const provider = creaProvider({ access_token: "vecchio", refresh_token: "r-1", expires_at: Date.now() + 30_000 });
  await provider.listFiles("/Documenti");
  assert.equal(provider.credentials.access_token, "nuovo-token",
    "trenta secondi alla scadenza sono meno del margine: si rinnova prima, o il 401 arriva a meta sincronizzazione");
  assert.ok(provider.takeRefreshedCredentials(), "e l'host deve poterlo salvare");
});
