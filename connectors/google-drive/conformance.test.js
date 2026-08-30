"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const {
  registerConformanceTests,
  createReplayTransport,
} = require("@vinovalab/storage-connector-contract");

const GoogleDriveProvider = require("./provider");
const manifest = require("./manifest");
const scenario = require("./scenario");

const ENV = {
  GOOGLE_OAUTH_CLIENT_ID: "client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
  GOOGLE_OAUTH_REDIRECT_URI: "https://example.test/oauth/google/callback",
};

const CREDENZIALI = {
  access_token: "token-valido",
  refresh_token: "r-1",
  expiry_date: Date.now() + 3600_000,
};

const creaProvider = (credenziali = CREDENZIALI) => new GoogleDriveProvider({
  credentials: { ...credenziali },
  env: ENV,
  http: createReplayTransport({ dir: path.join(__dirname, "fixtures") }),
  logger: { info() {}, warning() {}, error() {} },
});

registerConformanceTests(test, { createProvider: () => creaProvider(), manifest, scenario });

// ── oltre la conformita: cio che e specifico di Drive ────────────────────

test("[invariante] un documento nativo si esporta, e il mime cambia", async () => {
  // E' la ragione per cui il contratto vuole `{ buffer, mimeType }` e non un
  // Buffer: cio che si scarica da un Documento Google e un PDF, e chi lo salva
  // deve saperlo, o si ritrova un file `.gdoc` che nessun estrattore apre.
  const esito = await creaProvider().downloadFile("D-verbale", "application/vnd.google-apps.document", {});
  assert.equal(esito.mimeType, "application/pdf");
  assert.match(esito.buffer.toString("utf8"), /esportato da Google Docs/);
});

test("[invariante] un file binario si scarica com'e", async () => {
  const esito = await creaProvider().downloadFile("D-relazione", "application/pdf", {});
  assert.equal(esito.mimeType, "application/pdf");
  assert.equal(esito.buffer.length, 28);
});

test("[invariante] le scorciatoie non entrano nell'elenco", async () => {
  const file = await creaProvider().listFiles("F-documenti");
  assert.equal(file.some((f) => f.id === "D-scorciatoia"), false,
    "una scorciatoia non ha contenuto: elencarla produce un download fallito a ogni sincronizzazione");
});

test("[invariante] il cestino e una cancellazione", async () => {
  // Google non dice «rimosso» per un file cestinato: dice che e cambiato, con
  // `trashed: true`. Trattarlo come una modifica terrebbe indicizzato un
  // documento che l'utente ha buttato via.
  const { changes } = await creaProvider().getChanges("12345");
  const cestinato = changes.find((c) => c.fileId === "D-relazione");
  assert.equal(cestinato.type, "deleted");
});

test("[invariante] il cursore finale e newStartPageToken, non l'ultimo nextPageToken", async () => {
  // Drive chiude l'elenco dei cambiamenti con un token nuovo, da cui ripartire.
  // Salvare l'ultimo `nextPageToken` farebbe rileggere gli stessi cambiamenti
  // per sempre.
  const esito = await creaProvider().getChanges("12345");
  assert.equal(esito.nextPageToken, "12399");
});

test("[invariante] il documento nativo dichiara come verra esportato", async () => {
  const file = await creaProvider().listFiles("F-documenti");
  const verbale = file.find((f) => f.id === "D-verbale");
  assert.equal(verbale.exportMimeType, "application/pdf");
  assert.equal(verbale.isIndexable, true, "un Documento Google ha testo: va indicizzato");
  assert.equal(verbale.size, null, "i documenti nativi non hanno una dimensione finche non si esportano");
});

test("[invariante] l'autorizzazione chiede offline e consent", () => {
  // Senza `prompt=consent`, alla seconda autorizzazione Google non rimanda il
  // refresh token: la connessione funziona un'ora e poi muore.
  const url = new URL(creaProvider().getAuthUrl("stato-123"));
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("state"), "stato-123");
  assert.match(url.searchParams.get("scope"), /drive\.readonly/);
});

test("[invariante] il rinnovo conserva il refresh token", async () => {
  // Google non lo rimanda mai nei rinnovi: perderlo qui significa non poter
  // piu rinnovare, e la connessione muore all'ora successiva.
  const provider = creaProvider({ access_token: "vecchio", refresh_token: "r-1", expiry_date: Date.now() + 10_000 });
  await provider.listFiles("F-documenti");
  assert.equal(provider.credentials.access_token, "nuovo-token");
  assert.equal(provider.credentials.refresh_token, "r-1");
});
