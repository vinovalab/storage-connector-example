"use strict";

const { defineManifest } = require("@vinovalab/storage-connector-contract");

// Il manifesto e tutto cio che l'host deve sapere senza leggere il codice.
// Copiando questa cartella dentro storage-connector-service non si tocca
// nessun altro file: le etichette, l'autenticazione, le variabili richieste e
// le capacita sono dichiarate qui.
module.exports = defineManifest({
  key: "DROPBOX",
  label: "Dropbox",
  description: "Sincronizza i file da un account Dropbox personale o Business.",
  icon: "mdi:dropbox",
  contractVersion: "1.0.0",
  transport: "http",

  auth: {
    kind: "oauth2",
    // `files.metadata.read` per elencare, `files.content.read` per scaricare.
    // Dichiararli qui e cio che permette all'host di costruire l'URL di
    // autorizzazione senza sapere niente di Dropbox.
    scopes: ["files.metadata.read", "files.content.read"],
    redirectPath: "/oauth/dropbox/callback",
  },

  config: [
    { key: "DROPBOX_APP_KEY", required: true, description: "App key dell'applicazione Dropbox." },
    { key: "DROPBOX_APP_SECRET", required: true, secret: true, description: "App secret dell'applicazione Dropbox." },
    { key: "DROPBOX_REDIRECT_URI", required: true, description: "URL di callback registrato nella console Dropbox." },
  ],

  capabilities: {
    // Dropbox ha i cursori: `list_folder/continue` dice cosa e cambiato senza
    // rileggere tutto.
    deltaSync: true,
    folderPicker: true,
    // **Gli identificatori sono percorsi**, non id opachi. E' la differenza che
    // obbliga a sovrascrivere `fileBelongsToFolder`, ed e la ragione per cui
    // questo connettore, e non Drive, e il modello da imitare per Box, pCloud,
    // Nextcloud e i NAS.
    pathBasedMatching: true,
    exportsNativeFormats: false,
  },

  source: {
    repo: "https://github.com/vinovalab/storage-connector-example",
    version: "1.0.0",
  },
});
