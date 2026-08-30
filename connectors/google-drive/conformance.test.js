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

const CREDENTIALS = {
  access_token: "valid-token",
  refresh_token: "r-1",
  expiry_date: Date.now() + 3600_000,
};

const createProvider = (credentials = CREDENTIALS) => new GoogleDriveProvider({
  credentials: { ...credentials },
  env: ENV,
  http: createReplayTransport({ dir: path.join(__dirname, "fixtures") }),
  logger: { info() {}, warning() {}, error() {} },
});

registerConformanceTests(test, { createProvider: () => createProvider(), manifest, scenario });

// ── beyond conformance: what is specific to Drive ────────────────────────

test("[invariant] a native document is exported, and the mime type changes", async () => {
  // This is why the contract asks for `{ buffer, mimeType }` rather than a
  // Buffer: what comes back from a Google Doc is a PDF, and whoever saves it
  // needs to know — otherwise it lands as a `.gdoc` that no extractor opens.
  const result = await createProvider().downloadFile("D-minutes", "application/vnd.google-apps.document", {});
  assert.equal(result.mimeType, "application/pdf");
  assert.match(result.buffer.toString("utf8"), /exported from Google Docs/);
});

test("[invariant] a binary file is downloaded as it is", async () => {
  const result = await createProvider().downloadFile("D-report", "application/pdf", {});
  assert.equal(result.mimeType, "application/pdf");
  assert.equal(result.buffer.length, 22);
});

test("[invariant] shortcuts stay out of the list", async () => {
  const files = await createProvider().listFiles("F-documents");
  assert.equal(files.some((f) => f.id === "D-shortcut"), false,
    "a shortcut has no content: listing it produces a failed download on every synchronisation");
});

test("[invariant] the wastebasket is a deletion", async () => {
  // Google does not say "removed" for a trashed file: it says the file changed,
  // with `trashed: true`. Treating that as a modification keeps a document the
  // user threw away in the index.
  const { changes } = await createProvider().getChanges("12345");
  const trashed = changes.find((c) => c.fileId === "D-report");
  assert.equal(trashed.type, "deleted");
});

test("[invariant] the final cursor is newStartPageToken, not the last nextPageToken", async () => {
  // Drive closes a change list with a fresh token to resume from. Storing the
  // last `nextPageToken` instead makes the same changes come back for ever.
  const result = await createProvider().getChanges("12345");
  assert.equal(result.nextPageToken, "12399");
});

test("[invariant] a native document declares how it will be exported", async () => {
  const files = await createProvider().listFiles("F-documents");
  const minutes = files.find((f) => f.id === "D-minutes");
  assert.equal(minutes.exportMimeType, "application/pdf");
  assert.equal(minutes.isIndexable, true, "a Google Doc has text: it belongs in the index");
  assert.equal(minutes.size, null, "native documents have no size until they are exported");
});

test("[invariant] the authorisation asks for offline and consent", () => {
  // Without `prompt=consent`, a second authorisation returns no refresh token:
  // the connection works for an hour and then dies.
  const url = new URL(createProvider().getAuthUrl("state-123"));
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("state"), "state-123");
  assert.match(url.searchParams.get("scope"), /drive\.readonly/);
});

test("[invariant] renewing keeps the refresh token", async () => {
  // Google never sends it back on a renewal: losing it here means never being
  // able to renew again, and the connection dies within the hour.
  const provider = createProvider({ access_token: "old", refresh_token: "r-1", expiry_date: Date.now() + 10_000 });
  await provider.listFiles("F-documents");
  assert.equal(provider.credentials.access_token, "new-token");
  assert.equal(provider.credentials.refresh_token, "r-1");
});
