"use strict";

const { defineManifest } = require("@vinovalab/storage-connector-contract");

// The manifest is everything the host needs to know without reading the code.
// Copying this folder into storage-connector-service touches no other file:
// labels, authentication, required variables and capabilities are declared here.
module.exports = defineManifest({
  key: "DROPBOX",
  label: "Dropbox",
  description: "Synchronises files from a personal or Business Dropbox account.",
  icon: "mdi:dropbox",
  contractVersion: "1.0.0",
  transport: "http",

  auth: {
    kind: "oauth2",
    // `files.metadata.read` to list, `files.content.read` to download. Declaring
    // them here is what lets the host build the authorisation URL while knowing
    // nothing about Dropbox.
    scopes: ["files.metadata.read", "files.content.read"],
    redirectPath: "/oauth/dropbox/callback",
  },

  config: [
    { key: "DROPBOX_APP_KEY", required: true, description: "App key of the Dropbox application." },
    { key: "DROPBOX_APP_SECRET", required: true, secret: true, description: "App secret of the Dropbox application." },
    { key: "DROPBOX_REDIRECT_URI", required: true, description: "Callback URL registered in the Dropbox console." },
  ],

  capabilities: {
    // Dropbox has cursors: `list_folder/continue` reports what changed without
    // reading everything again.
    deltaSync: true,
    folderPicker: true,
    // **Identifiers are paths**, not opaque ids. That difference is what forces
    // `fileBelongsToFolder` to be overridden, and it is why this connector — not
    // Drive — is the one to imitate for Box, pCloud, Nextcloud and NAS devices.
    pathBasedMatching: true,
    exportsNativeFormats: false,
  },

  source: {
    repo: "https://github.com/vinovalab/storage-connector-example",
    version: "1.0.0",
  },
});
