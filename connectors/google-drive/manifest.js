"use strict";

const { defineManifest } = require("@vinovalab/storage-connector-contract");

module.exports = defineManifest({
  key: "GOOGLE_DRIVE",
  label: "Google Drive",
  description: "Synchronises files from Google Drive, exporting native documents as PDF.",
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
    { key: "GOOGLE_OAUTH_CLIENT_ID", required: true, description: "OAuth client ID of the Google Cloud project." },
    { key: "GOOGLE_OAUTH_CLIENT_SECRET", required: true, secret: true, description: "OAuth client secret." },
    { key: "GOOGLE_OAUTH_REDIRECT_URI", required: true, description: "Redirect URI registered in the Google project." },
  ],

  capabilities: {
    deltaSync: true,
    folderPicker: true,
    // Drive identifiers are opaque and folders have an id of their own, so the
    // contract's default parent comparison is right here: no override needed.
    pathBasedMatching: false,
    // Docs, Sheets and Slides have no file to download — they are exported.
    // That peculiarity is what makes Drive a poor mould for other connectors.
    exportsNativeFormats: true,
  },

  source: {
    repo: "https://github.com/vinovalab/storage-connector-example",
    version: "1.0.0",
  },
});
