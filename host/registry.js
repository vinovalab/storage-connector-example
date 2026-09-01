"use strict";

// The connector registry: it reads the directory, never a hand-written list.
//
// This is the rule that makes the repository a model rather than an example. In
// the real service a connector is **a folder and nothing else**:
// `connectors/<name>/` with its manifest and its class, and copying it in is the
// whole installation. If this minimal host kept a list to update, a collaborator
// would learn exactly the gesture the contract exists to remove.
//
// The three rejections are the ones the real service makes:
//   * a malformed manifest — better at startup than in a customer's hands;
//   * a different contract major — a connector written against old rules would
//     fail at the first delta, silently;
//   * a duplicate key — two folders declaring DROPBOX are a copy mistake, and
//     alphabetical order would decide, which is to say chance.
//
// A connector missing its configuration is **not** rejected: it is loaded and
// marked off, with the list of what is missing. That is the difference between a
// connector that never appears and nobody knows why, and one that appears
// switched off saying which variable it wants.

const fs = require("fs");
const path = require("path");
const { compatible, missingConfig, CONTRACT_VERSION } = require("@vinovalab/storage-connector-contract");

const DIRECTORY = path.join(__dirname, "..", "connectors");

function readRegistry() {
  if (!fs.existsSync(DIRECTORY)) return { connectors: [], rejected: [] };

  const connectors = [];
  const rejected = [];
  const keysSeen = new Map();

  for (const entry of fs.readdirSync(DIRECTORY, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const dir = entry.name;
    const base = path.join(DIRECTORY, dir);
    const manifestFile = path.join(base, "manifest.js");
    const providerFile = path.join(base, "provider.js");

    if (!fs.existsSync(manifestFile)) {
      rejected.push({ dir, reason: "manifest.js is missing" });
      continue;
    }
    if (!fs.existsSync(providerFile)) {
      rejected.push({ dir, reason: "provider.js is missing" });
      continue;
    }

    let manifest;
    try {
      // Read again on every pass: a connector being written changes under your
      // hands, and a cached manifest would show yesterday's shape.
      delete require.cache[require.resolve(manifestFile)];
      manifest = require(manifestFile);
    } catch (error) {
      rejected.push({ dir, reason: `invalid manifest: ${error.message}` });
      continue;
    }

    if (!compatible(manifest)) {
      rejected.push({
        dir,
        reason: `contract ${manifest.contractVersion} is not compatible with ${CONTRACT_VERSION}`,
      });
      continue;
    }

    const already = keysSeen.get(manifest.key);
    if (already) {
      rejected.push({ dir, reason: `key ${manifest.key} is already declared by ${already}` });
      continue;
    }
    keysSeen.set(manifest.key, dir);

    const missing = missingConfig(manifest, process.env);
    connectors.push({
      dir,
      key: manifest.key,
      label: manifest.label,
      description: manifest.description ?? null,
      contractVersion: manifest.contractVersion,
      authKind: manifest.auth?.kind ?? null,
      redirectPath: manifest.auth?.redirectPath ?? null,
      capabilities: manifest.capabilities ?? {},
      config: (manifest.config ?? []).map((c) => ({
        key: c.key, required: Boolean(c.required), secret: Boolean(c.secret),
        description: c.description ?? null,
      })),
      // Off, not absent.
      enabled: missing.length === 0,
      missingConfig: missing,
      hasSuite: fs.existsSync(path.join(base, "conformance.test.js")),
      hasFixtures: fs.existsSync(path.join(base, "fixtures")),
    });
  }

  return { connectors, rejected };
}

// The manifest and the class, for whoever has to build a provider. The registry
// reads the manifest; only here is the connector's code touched.
function loadConnector(dir) {
  const base = path.join(DIRECTORY, dir);
  delete require.cache[require.resolve(path.join(base, "manifest.js"))];
  delete require.cache[require.resolve(path.join(base, "provider.js"))];
  return {
    manifest: require(path.join(base, "manifest.js")),
    Provider: require(path.join(base, "provider.js")),
    base,
  };
}

module.exports = { readRegistry, loadConnector, DIRECTORY };
