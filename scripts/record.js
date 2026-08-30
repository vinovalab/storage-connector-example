"use strict";

// Registra le risposte vere del provider e le scrive come fixture.
//
// Si esegue **una volta**, sul portatile di chi sviluppa il connettore, con
// credenziali vere e un account di prova preparato come descrive lo scenario.
// Da quel momento la conformita gira offline, in CI e in mano a chi revisiona.
//
//   GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... \
//   DRIVE_ACCESS_TOKEN=... DRIVE_REFRESH_TOKEN=... \
//   node scripts/record.js google-drive
//
// Le fixture esistenti **non** vengono cancellate: si sovrascrivono solo quelle
// delle chiamate rifatte. Rileggile prima di committarle — finiscono in un
// repository pubblico, e la ripulitura automatica copre i campi noti
// (`authorization`, `access_token`, `refresh_token`, `client_secret`, password,
// cookie), non un token che il provider abbia deciso di mettere altrove.

const path = require("path");
const axios = require("axios");
const { createRecordingTransport } = require("@vinovalab/storage-connector-contract");

const cartella = process.argv[2];
if (!cartella) {
  console.error("Uso: node scripts/record.js <cartella-connettore>");
  process.exit(1);
}

const base = path.join(__dirname, "..", "connectors", cartella);
const Provider = require(path.join(base, "provider.js"));
const manifest = require(path.join(base, "manifest.js"));
const scenario = require(path.join(base, "scenario.js"));

// Il client vero: axios con la forma che il contratto si aspetta.
const reale = async (config) => axios({ ...config, validateStatus: () => true, timeout: 30_000 })
  .then((r) => {
    if (r.status >= 400) {
      const err = new Error(`Richiesta fallita con stato ${r.status}`);
      err.status = r.status;
      err.response = r;
      throw err;
    }
    return r;
  });

async function main() {
  const env = Object.fromEntries(manifest.config.map((v) => [v.key, process.env[v.key]]));
  const mancanti = manifest.config.filter((v) => v.required && !env[v.key]).map((v) => v.key);
  if (mancanti.length) {
    console.error(`Mancano le variabili: ${mancanti.join(", ")}`);
    process.exit(1);
  }

  const provider = new Provider({
    credentials: {
      access_token: process.env.CONNECTOR_ACCESS_TOKEN || "",
      refresh_token: process.env.CONNECTOR_REFRESH_TOKEN || "",
    },
    env,
    http: createRecordingTransport({ dir: path.join(base, "fixtures"), http: reale }),
    logger: console,
  });

  // Si registrano esattamente le chiamate che la conformita fara: se ne manca
  // una, il test lo dira nominandola.
  console.log("→ testConnection");
  console.log(await provider.testConnection());

  console.log("→ listFolders");
  console.log(await provider.listFolders(scenario.folders?.parentId ?? null));

  console.log("→ listFiles");
  console.log((await provider.listFiles(scenario.files.folderId)).map((f) => f.id));

  if (scenario.recursive) {
    console.log("→ listFilesRecursive");
    console.log((await provider.listFilesRecursive(scenario.recursive.folderId)).map((f) => f.id));
  }

  console.log("→ downloadFile");
  const scaricato = await provider.downloadFile(scenario.download.fileId, scenario.download.mimeType, {});
  console.log(`${scaricato.buffer.length} byte, ${scaricato.mimeType}`);

  if (manifest.capabilities.deltaSync) {
    console.log("→ getChanges(null)");
    console.log(await provider.getChanges(null));
    console.log("→ getChanges(cursore)  — modifica e cancella qualcosa nell'account, poi premi invio");
    await new Promise((risolvi) => process.stdin.once("data", risolvi));
    console.log(await provider.getChanges(scenario.changes.cursor));
  }

  console.log("\nFixture aggiornate in", path.join(base, "fixtures"));
  console.log("Rileggile prima di committarle.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err?.response?.data || err);
  process.exit(1);
});
