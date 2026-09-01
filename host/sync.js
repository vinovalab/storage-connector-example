"use strict";

// The full round: this is what no fixture can verify.
//
// Conformance checks the **shape** of getChanges against recorded responses. It
// cannot tell you that a connector does not re-download the whole archive on
// every synchronisation: that only shows against a real account, and it is one
// of the three mistakes the contract exists to prevent.
//
// The rule, from the contract: `getChanges(null)` does **not** list everything.
// It returns the starting cursor and `isInitial: true`. The full scan is the
// host's job, the first time and once only; a connector that answers with
// everything makes it happen twice.
//
//   first pass  → full scan + getChanges(null) for the cursor
//   later passes→ getChanges(cursor) → download the changed, remove the deleted

const fs = require("fs");
const path = require("path");
const { build, persistRefresh } = require("./provider");
const state = require("./state");

const DESTINATION = path.join(__dirname, "..", ".sync");

function localPath(dir, file) {
  // The identifier can be a path (Dropbox) or opaque (Drive): either way it is
  // flattened into a file name, because what matters here is seeing that the
  // content arrived, not rebuilding the tree.
  const name = String(file.name || file.id).replace(/[^\w.\-]+/g, "_").slice(-120);
  return path.join(DESTINATION, dir, name);
}

async function download(dir, provider, file, result) {
  try {
    const { buffer, mimeType } = await provider.downloadFile(file.id, file.mimeType, {});
    const destination = localPath(dir, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, buffer);
    result.downloaded.push({ id: file.id, name: file.name ?? null, bytes: buffer.length, mimeType });
  } catch (error) {
    result.errors.push({ id: file.id, message: error?.message || String(error) });
  }
}

async function synchronise(dir, { folderId }) {
  const started = Date.now();
  const { provider, manifest } = build(dir);
  const connection = state.connection(dir) || {};
  const previousCursor = connection.cursor || null;

  const result = {
    mode: previousCursor ? "incremental" : "full",
    folderId,
    downloaded: [],
    removed: [],
    errors: [],
    previousCursor,
    cursor: null,
    credentialsRenewed: false,
  };

  try {
    if (!previousCursor) {
      // First time: the scan is the host's job.
      const list = typeof provider.listFilesRecursive === "function"
        ? provider.listFilesRecursive.bind(provider)
        : provider.listFiles.bind(provider);
      const files = await list(folderId);
      result.found = (files || []).length;
      for (const f of files || []) await download(dir, provider, f, result);

      // And then the starting cursor, which lists nothing.
      if (manifest.capabilities?.deltaSync) {
        const start = await provider.getChanges(null);
        result.cursor = start?.nextPageToken ?? null;
        result.isInitial = start?.isInitial === true;
        if (Array.isArray(start?.changes) && start.changes.length > 0) {
          // Worth saying: this is the mistake that doubles every first sync.
          result.warnings = [
            `getChanges(null) returned ${start.changes.length} changes. The contract wants it to return `
            + "the starting cursor only: the full scan is the host's job, and this way it happens twice.",
          ];
        }
      }
    } else {
      const delta = await provider.getChanges(previousCursor);
      result.cursor = delta?.nextPageToken ?? previousCursor;
      const changes = Array.isArray(delta?.changes) ? delta.changes : [];
      result.seen = changes.length;

      for (const change of changes) {
        const belongs = provider.fileBelongsToFolder(
          change.file || change,
          { provider_folder_id: folderId, recursive: true },
        );
        if (!belongs) continue;

        if (change.type === "deleted" || change.deleted) {
          const destination = localPath(dir, change.file || change);
          if (fs.existsSync(destination)) fs.unlinkSync(destination);
          result.removed.push({ id: (change.file || change).id });
        } else {
          await download(dir, provider, change.file || change, result);
        }
      }
    }

    result.credentialsRenewed = persistRefresh(dir, provider);
    state.saveConnection(dir, { cursor: result.cursor, folderId, lastSync: new Date().toISOString() });
    result.ok = true;
  } catch (error) {
    // Renewed credentials must be saved even on failure: the renewal may have
    // succeeded and the call after it failed, and repeating it burns the refresh
    // token of providers that rotate it.
    result.credentialsRenewed = persistRefresh(dir, provider);
    result.ok = false;
    result.error = error?.message || String(error);
  }

  result.duration = Date.now() - started;
  return result;
}

module.exports = { synchronise, DESTINATION };
