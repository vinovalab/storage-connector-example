"use strict";

const { defineManifest } = require("@vinovalab/storage-connector-contract");

module.exports = defineManifest({
  key: "GOOGLE_DRIVE",
  label: "Google Drive",
  description: "Sincronizza i file da Google Drive, esportando i documenti nativi in PDF.",
  icon: "mdi:google-drive",
  contractVersion: "1.0.0",
  transport: "http",

  auth: {
    kind: "oauth2",
    scopes: [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/drive.metadata.readonly",
    ],
    redirectPath: "/oauth/google/callback",
  },

  config: [
    { key: "GOOGLE_OAUTH_CLIENT_ID", required: true, description: "Client ID OAuth del progetto Google Cloud." },
    { key: "GOOGLE_OAUTH_CLIENT_SECRET", required: true, secret: true, description: "Client secret OAuth." },
    { key: "GOOGLE_OAUTH_REDIRECT_URI", required: true, description: "URI di redirect registrato nel progetto Google." },
  ],

  capabilities: {
    deltaSync: true,
    folderPicker: true,
    // Gli identificatori di Drive sono opachi e le cartelle hanno un id: il
    // confronto predefinito fra genitori va bene, non serve sovrascriverlo.
    pathBasedMatching: false,
    // Documenti, Fogli e Presentazioni non hanno un file da scaricare: si
    // esportano. E' la particolarita che rende Drive un cattivo stampo per gli
    // altri connettori.
    exportsNativeFormats: true,
  },

  source: {
    repo: "https://github.com/vinovalab/storage-connector-example",
    version: "1.0.0",
  },
});
