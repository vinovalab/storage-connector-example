"use strict";

// The minimal host: the smallest version of storage-connector-service that is
// enough to run a connector end to end.
//
// No database, no authentication, no other service. That is not laziness: it is
// the condition for a collaborator to run `npm start` and see their connector
// work. A host that asks for Postgres is a host nobody starts.
//
// What it does keep, to the letter, are the contract's rules, because they are
// the reason it exists:
//   * connectors are discovered by reading the directory, never a list;
//   * the manifest is read, not the code;
//   * refreshed credentials are persisted once;
//   * getChanges(null) gives the cursor, not the archive.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");

const ROOT = path.join(__dirname, "..");

// The variables live in the root .env, the same file scripts/record.js reads.
// No exporting by hand: it is the first thing people forget.
const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile) && typeof process.loadEnvFile === "function") {
  try { process.loadEnvFile(envFile); } catch { /* already loaded */ }
}

// Before anything else: is the contract there?
//
// Without it Node throws MODULE_NOT_FOUND with a six-line stack that does not
// say what to do. It is the same missing install that has already shown up as an
// npm 404 and as "Cannot find module axios": worth ten lines, once.
try {
  require.resolve("@vinovalab/storage-connector-contract");
} catch {
  console.error("");
  console.error("  @vinovalab/storage-connector-contract is not installed.");
  console.error("");
  console.error("  The install goes in the ROOT of the repository, not only in web/:");
  console.error("");
  console.error("    cp .npmrc.example .npmrc     # without it npm asks npmjs and gets a 404");
  console.error("    set -a; . ./.env; set +a     # NODE_AUTH_TOKEN, which npm does not read on its own");
  console.error("    npm install");
  console.error("");
  console.error("  The token is in your challenge details on collaborators.vinovalab.ai");
  console.error("  and it needs read:packages.");
  console.error("");
  process.exit(1);
}

const { readRegistry } = require("./registry");
const { build, persistRefresh } = require("./provider");
const { synchronise, DESTINATION } = require("./sync");
const state = require("./state");
const { runConformance } = require("./conformance");

const PORT = Number(process.env.HOST_PORT || 5191);
const app = express();
app.use(express.json());

// Pending OAuth states: they tie the provider's answer to a request that started
// here. Without one, this page would accept a code from anyone.
const pendingStates = new Map();

function findConnector(dir) {
  return readRegistry().connectors.find((c) => c.dir === dir) || null;
}

// ── Registry ────────────────────────────────────────────────────────────────

app.get("/api/connectors", (_req, res) => {
  const { connectors, rejected } = readRegistry();
  res.json({
    data: connectors.map((c) => ({
      ...c,
      connection: (() => {
        const s = state.connection(c.dir);
        return {
          authorised: Boolean(s?.credentials?.access_token),
          hasRefresh: Boolean(s?.credentials?.refresh_token),
          folderId: s?.folderId ?? null,
          cursor: s?.cursor ?? null,
          lastSync: s?.lastSync ?? null,
        };
      })(),
    })),
    rejected,
  });
});

// ── Conformance, against recorded responses ─────────────────────────────────

app.post("/api/connectors/:dir/test", async (req, res) => {
  const c = findConnector(req.params.dir);
  if (!c) return res.status(404).json({ error: "Unknown connector." });
  res.json({ data: await runConformance(c.dir) });
});

// ── Authorisation ───────────────────────────────────────────────────────────

app.get("/api/connectors/:dir/auth-url", (req, res) => {
  const c = findConnector(req.params.dir);
  if (!c) return res.status(404).json({ error: "Unknown connector." });
  if (!c.enabled) {
    return res.status(409).json({ error: `Incomplete configuration: ${c.missingConfig.join(", ")}. They go in the root .env.` });
  }
  try {
    const { provider } = build(c.dir);
    const key = crypto.randomBytes(16).toString("hex");
    pendingStates.set(key, c.dir);
    res.json({ data: { url: provider.getAuthUrl(key), redirectPath: c.redirectPath } });
  } catch (error) {
    res.status(400).json({ error: error?.message || String(error) });
  }
});

// The return from the provider. The path is declared by the manifest, so there
// is not just one: the connector claiming it is looked up.
app.get(/^\/oauth\/.+/, async (req, res) => {
  const c = readRegistry().connectors.find((x) => x.redirectPath === req.path);
  const page = (title, body) => res.type("html").send(
    `<!doctype html><meta charset="utf-8"><title>${title}</title>`
    + `<body style="font:15px/1.6 system-ui;max-width:44rem;margin:4rem auto;padding:0 1rem;color:#253f3a">`
    + body + `<p><a href="/">Back to the page</a></p></body>`);

  if (!c) return res.status(404).type("html").send("No connector declares this callback path.");
  if (req.query.error) return page("Authorisation refused", `<h1>Authorisation refused</h1><p>The provider answered <code>${req.query.error}</code>.</p>`);

  const key = String(req.query.state || "");
  if (!req.query.code || pendingStates.get(key) !== c.dir) {
    return page("Request not recognised",
      "<h1>Request not recognised</h1><p>The code is missing, or the state does not match any authorisation started from here.</p>");
  }
  pendingStates.delete(key);

  try {
    const { provider } = build(c.dir);
    const credentials = await provider.exchangeCode(String(req.query.code));
    state.saveConnection(c.dir, { credentials: credentials || {} });
    return page("Authorised", `<h1>Authorised</h1><p><strong>${c.label}</strong> released the credentials.`
      + (credentials?.refresh_token
        ? " With a refresh token."
        : " <em>Without</em> a refresh token: the connection will die at expiry, silently. It is one of the three mistakes the contract exists to prevent.")
      + `</p>`);
  } catch (error) {
    return page("Exchange failed", `<h1>Exchange failed</h1><p>${String(error?.message || error)}</p>`);
  }
});

app.delete("/api/connectors/:dir/connection", (req, res) => {
  state.forgetConnection(req.params.dir);
  res.json({ data: { forgotten: true } });
});

// ── Live connection ─────────────────────────────────────────────────────────

app.post("/api/connectors/:dir/live", async (req, res) => {
  const c = findConnector(req.params.dir);
  if (!c) return res.status(404).json({ error: "Unknown connector." });
  if (!c.enabled) return res.status(409).json({ error: `Incomplete configuration: ${c.missingConfig.join(", ")}.` });
  if (!state.connection(c.dir)?.credentials?.access_token) {
    return res.status(409).json({ error: "No credentials: authorise the connector first." });
  }

  const started = Date.now();
  const steps = [];
  const { provider } = build(c.dir);
  try {
    // Two calls and not one: testConnection can pass with permissions too narrow
    // to read anything, and an empty listing only shows when you ask for it.
    const result = await provider.testConnection();
    steps.push({ name: "testConnection", ok: true, detail: JSON.stringify(result ?? null).slice(0, 300) });
    const folders = await provider.listFolders(null);
    steps.push({ name: "listFolders(null)", ok: true, detail: `${(folders || []).length} folders` });
    persistRefresh(c.dir, provider);
    res.json({ data: { ok: true, steps, duration: Date.now() - started } });
  } catch (error) {
    persistRefresh(c.dir, provider);
    steps.push({ name: steps.length ? "listFolders(null)" : "testConnection", ok: false, detail: error?.message || String(error) });
    res.json({ data: { ok: false, steps, duration: Date.now() - started } });
  }
});

// ── Folders and synchronisation ─────────────────────────────────────────────

app.get("/api/connectors/:dir/folders", async (req, res) => {
  const c = findConnector(req.params.dir);
  if (!c) return res.status(404).json({ error: "Unknown connector." });
  // A connector that is off says so. Without this the provider is built anyway
  // and fails deep inside with something like "access token is missing", which
  // sends whoever reads it looking for a token instead of a variable.
  if (!c.enabled) return res.status(409).json({ error: `Incomplete configuration: ${c.missingConfig.join(", ")}.` });
  try {
    const { provider } = build(c.dir);
    const folders = await provider.listFolders(req.query.parentId ? String(req.query.parentId) : null);
    persistRefresh(c.dir, provider);
    res.json({ data: folders || [] });
  } catch (error) {
    res.status(502).json({ error: error?.message || String(error) });
  }
});

app.post("/api/connectors/:dir/sync", async (req, res) => {
  const c = findConnector(req.params.dir);
  if (!c) return res.status(404).json({ error: "Unknown connector." });
  if (!c.enabled) return res.status(409).json({ error: `Incomplete configuration: ${c.missingConfig.join(", ")}.` });
  const folderId = req.body?.folderId ?? state.connection(c.dir)?.folderId ?? null;
  if (folderId === null || folderId === undefined) {
    return res.status(400).json({ error: "Choose a folder to monitor first." });
  }
  res.json({ data: await synchronise(c.dir, { folderId }) });
});

// Start over: forget the cursor and the downloaded files. It is for retrying the
// first synchronisation without redoing the authorisation.
app.post("/api/connectors/:dir/reset", (req, res) => {
  const current = state.connection(req.params.dir) || {};
  state.saveConnection(req.params.dir, { cursor: null, folderId: current.folderId ?? null });
  const folder = path.join(DESTINATION, req.params.dir);
  if (fs.existsSync(folder)) fs.rmSync(folder, { recursive: true, force: true });
  res.json({ data: { reset: true } });
});

// The built page, if there is one: `npm run build && npm start` is then a single
// process. In development you reach it through the Vite dev server, which proxies.
const dist = path.join(ROOT, "web", "dist");
if (fs.existsSync(dist)) app.use(express.static(dist));

// A JSON API must never answer in HTML. Express's default handler renders a
// page, and a malformed body — or any unhandled throw — reaches the caller as
// markup it cannot parse, on top of whatever went wrong.
// eslint-disable-next-line no-unused-vars
app.use((error, req, res, _next) => {
  const status = error?.status && error.status >= 400 && error.status < 600 ? error.status : 500;
  if (req.path.startsWith("/api/")) {
    return res.status(status).json({ error: error?.message || "Unexpected error." });
  }
  res.status(status).type("text/plain").send(error?.message || "Unexpected error.");
});

app.listen(PORT, () => {
  const { connectors, rejected } = readRegistry();
  console.log(`storage-connector-host on http://localhost:${PORT}`);
  for (const c of connectors) {
    console.log(`  ${c.key}${c.enabled ? "" : `  off — missing ${c.missingConfig.join(", ")}`}`);
  }
  for (const r of rejected) console.log(`  ${r.dir}  REJECTED — ${r.reason}`);
  if (!fs.existsSync(dist)) console.log("  (web/dist absent: use the Vite dev server in web/)");
});
