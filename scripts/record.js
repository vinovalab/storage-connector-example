"use strict";

// Records the provider's real responses and writes them out as fixtures.
//
// Run it **once**, on the machine of whoever is writing the connector, with real
// credentials and a test account prepared as the scenario describes. From then
// on conformance runs offline: in CI, on a reviewer's laptop, and months later.
//
//   cp .env.example .env      # then fill it in
//   npm run record -- google-drive
//
// The variables can also be passed on the command line, and they take
// precedence over the file:
//
//   CONNECTOR_ACCESS_TOKEN=... node scripts/record.js google-drive
//
// Existing fixtures are **not** deleted: only the calls you make again are
// overwritten. Read them before committing — they end up in a repository, and
// the automatic redaction covers the fields it knows (`authorization`,
// `access_token`, `refresh_token`, `client_secret`, passwords, cookies), not a
// token a provider decided to put somewhere else.

const path = require("path");
const fs = require("fs");
const axios = require("axios");
const { createRecordingTransport } = require("@vinovalab/storage-connector-contract");

// The `.env` in the repository root, if there is one. `.env.example` is the
// template to copy, and it is the only place the README tells anyone to put
// these values: without this, that file would be a suggestion nothing reads.
//
// Variables already set in the environment win over the file, so a value can be
// overridden for a single run without editing anything.
const fileEnv = path.join(__dirname, "..", ".env");
if (fs.existsSync(fileEnv)) {
  if (typeof process.loadEnvFile === "function") {
    process.loadEnvFile(fileEnv);
  } else {
    console.error(`Found ${fileEnv}, but this Node (${process.version}) cannot read it: use Node 20.12 or newer, or pass the variables on the command line.`);
    process.exit(1);
  }
}

const directory = process.argv[2];
if (!directory) {
  console.error("Usage: node scripts/record.js <connector-directory>");
  process.exit(1);
}

const base = path.join(__dirname, "..", "connectors", directory);
const Provider = require(path.join(base, "provider.js"));
const manifest = require(path.join(base, "manifest.js"));
const scenario = require(path.join(base, "scenario.js"));

// The real client: axios, shaped the way the contract expects.
const real = async (config) => axios({ ...config, validateStatus: () => true, timeout: 30_000 })
  .then((r) => {
    if (r.status >= 400) {
      const err = new Error(`Request failed with status ${r.status}`);
      err.status = r.status;
      err.response = r;
      throw err;
    }
    return r;
  });

async function main() {
  const env = Object.fromEntries(manifest.config.map((v) => [v.key, process.env[v.key]]));
  const missing = manifest.config.filter((v) => v.required && !env[v.key]).map((v) => v.key);
  if (missing.length) {
    console.error(`Missing variables: ${missing.join(", ")}`);
    process.exit(1);
  }

  const provider = new Provider({
    credentials: {
      access_token: process.env.CONNECTOR_ACCESS_TOKEN || "",
      refresh_token: process.env.CONNECTOR_REFRESH_TOKEN || "",
    },
    env,
    http: createRecordingTransport({ dir: path.join(base, "fixtures"), http: real }),
    logger: console,
  });

  // Exactly the calls conformance will make are recorded here: if one is
  // missing, the test says which one by name.
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
  const downloaded = await provider.downloadFile(scenario.download.fileId, scenario.download.mimeType, {});
  console.log(`${downloaded.buffer.length} bytes, ${downloaded.mimeType}`);

  if (manifest.capabilities.deltaSync) {
    console.log("→ getChanges(null)");
    console.log(await provider.getChanges(null));
    console.log("→ getChanges(cursor)  — change and delete something in the account, then press enter");
    await new Promise((resolve) => process.stdin.once("data", resolve));
    console.log(await provider.getChanges(scenario.changes.cursor));
  }

  console.log("\nFixtures updated in", path.join(base, "fixtures"));
  console.log("Read them before committing.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err?.response?.data || err);
  process.exit(1);
});
