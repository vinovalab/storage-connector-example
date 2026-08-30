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

// No test account is needed: the responses are recorded. That is what makes this
// verification repeatable in CI, on a reviewer's laptop, and six months from now
// when the account no longer exists.

const ENV = {
  DROPBOX_APP_KEY: "app-key",
  DROPBOX_APP_SECRET: "app-secret",
  DROPBOX_REDIRECT_URI: "https://example.test/oauth/dropbox/callback",
};

const CREDENTIALS = {
  access_token: "valid-token",
  refresh_token: "r-1",
  expires_at: Date.now() + 3600_000,
};

const createProvider = (credentials = CREDENTIALS) => new DropboxProvider({
  credentials: { ...credentials },
  env: ENV,
  http: createReplayTransport({ dir: path.join(__dirname, "fixtures") }),
  logger: { info() {}, warning() {}, error() {} },
});

registerConformanceTests(test, { createProvider: () => createProvider(), manifest, scenario });

// ── beyond conformance: what is specific to Dropbox ──────────────────────

test("[invariant] the root is the empty string, not «/»", async () => {
  // The only place where the two differ: `path: "/"` returns a 400 on the first
  // call, and Dropbox's error does not explain why.
  const folders = await createProvider().listFolders("/");
  assert.deepEqual(folders.map((f) => f.id), ["/documents"]);
});

test("[invariant] the identifier is the lowercase path", async () => {
  // The host stores it and hands it back to download the file. If it changed
  // between two synchronisations — capitalisation included — every file would
  // look new and the archive would be duplicated.
  const files = await createProvider().listFiles("/Documents");
  assert.ok(files.every((f) => f.id === f.id.toLowerCase()));
  assert.equal(files[0].pathDisplay, "/Documents/report.pdf", "the human-readable name keeps its capitals");
});

test("[invariant] a file that cannot be downloaded stays out of the list", async () => {
  // Dropbox marks Paper documents and unmounted shared spaces this way. Listing
  // them produces a failed download on every run, for ever. The fixture carries
  // one — `brainstorming.paper` — so the exclusion is proved through the public
  // surface rather than by reaching into the connector.
  const files = await createProvider().listFiles("/Documents");
  assert.equal(files.some((f) => f.id === "/documents/brainstorming.paper"), false);
  assert.equal(files.length, 4, "the other four are still there: the filter is narrow, not greedy");
});

test("[invariant] the mime type is inferred from the extension, and what is not indexable shows", async () => {
  const files = await createProvider().listFiles("/Documents");
  const byId = Object.fromEntries(files.map((f) => [f.id, f]));
  assert.equal(byId["/documents/report.pdf"].mimeType, "application/pdf");
  assert.equal(byId["/documents/report.pdf"].isIndexable, true);
  assert.equal(byId["/documents/image.png"].mimeType, "application/octet-stream",
    "Dropbox does not declare a mime type: with no recognised extension, none is invented");
  assert.equal(byId["/documents/image.png"].isIndexable, false,
    "an image has no text to extract: indexing it would be wasted work on every run");
});

test("[invariant] without `offline` no refresh token ever arrives", () => {
  // Dropbox issues a refresh token **only** if the authorisation asks for one.
  // Without it the connection works for four hours and then dies overnight.
  const url = new URL(createProvider().getAuthUrl("state-123"));
  assert.equal(url.searchParams.get("token_access_type"), "offline");
  assert.equal(url.searchParams.get("state"), "state-123", "the state comes back untouched, or the callback cannot tell whose it is");
  assert.equal(url.searchParams.get("client_id"), "app-key");
});

test("[invariant] an expiring token is renewed before the call, not after the 401", async () => {
  const provider = createProvider({ access_token: "old", refresh_token: "r-1", expires_at: Date.now() + 30_000 });
  await provider.listFiles("/Documents");
  assert.equal(provider.credentials.access_token, "new-token",
    "thirty seconds to expiry is inside the margin: renew first, or the 401 lands halfway through a synchronisation");
  assert.ok(provider.takeRefreshedCredentials(), "and the host must be able to persist it");
});
