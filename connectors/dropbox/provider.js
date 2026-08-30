"use strict";

// The Dropbox connector.
//
// This is the one to imitate. No SDK, every call inside `this.http`, identifiers
// that are paths, a cursor for the delta. Box, pCloud, Nextcloud and most NAS
// devices work the same way; Google Drive, with its opaque ids and its native
// documents, is the exception.

const nodePath = require("path");
const { BaseProvider } = require("@vinovalab/storage-connector-contract");

const API = "https://api.dropboxapi.com/2";
const CONTENT_API = "https://content.dropboxapi.com/2";
const AUTHORIZE_URL = "https://www.dropbox.com/oauth2/authorize";
const TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";

// Dropbox does not tell you the mime type: it has to be inferred from the
// extension. The list is deliberately short — it answers the same question as
// the contract's `isIndexable`, and extending one without the other produces
// files that are downloaded and never indexed.
const MIME_BY_EXTENSION = {
  ".csv": "text/csv",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".htm": "text/html",
  ".html": "text/html",
  ".md": "text/markdown",
  ".pdf": "application/pdf",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".rtf": "application/rtf",
  ".txt": "text/plain",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

// The root of a Dropbox account is the empty string, not "/". It is the only
// place where the two differ, and getting it wrong returns a 400 on the very
// first call with an error that does not explain why.
function toPath(value) {
  if (!value || value === "/") return "";
  return String(value).startsWith("/") ? String(value) : `/${value}`;
}

function parentPath(value) {
  const normalised = toPath(value);
  if (!normalised) return "";
  const cut = normalised.lastIndexOf("/");
  return cut <= 0 ? "" : normalised.slice(0, cut).toLowerCase();
}

const mimeFromName = (name) => MIME_BY_EXTENSION[nodePath.extname(String(name || "")).toLowerCase()]
  || "application/octet-stream";

class DropboxProvider extends BaseProvider {
  static get key() { return "DROPBOX"; }

  constructor(options = {}) {
    super(options);
    this._clientId = this.env.DROPBOX_APP_KEY || "";
    this._clientSecret = this.env.DROPBOX_APP_SECRET || "";
    this._redirectUri = this.env.DROPBOX_REDIRECT_URI || "";
  }

  // ── OAuth ───────────────────────────────────────────────────────────────

  getAuthUrl(state) {
    if (!this._clientId) throw new Error("DROPBOX_APP_KEY is missing.");
    const qs = new URLSearchParams({
      client_id: this._clientId,
      response_type: "code",
      // Without `offline` Dropbox never sends a refresh token, and the
      // connection dies four hours later, when nobody is watching.
      token_access_type: "offline",
      state,
    });
    if (this._redirectUri) qs.set("redirect_uri", this._redirectUri);
    return `${AUTHORIZE_URL}?${qs.toString()}`;
  }

  async exchangeCode(code) {
    const body = new URLSearchParams({
      code,
      grant_type: "authorization_code",
      client_id: this._clientId,
      client_secret: this._clientSecret,
    });
    if (this._redirectUri) body.set("redirect_uri", this._redirectUri);
    const response = await this.http({
      method: "POST",
      url: TOKEN_URL,
      data: body.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    return this._credentialsFrom(response.data);
  }

  async refreshCredentials() {
    const refreshToken = this.credentials.refresh_token;
    if (!refreshToken) return this.credentials;
    const body = new URLSearchParams({
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      client_id: this._clientId,
      client_secret: this._clientSecret,
    });
    const response = await this.http({
      method: "POST",
      url: TOKEN_URL,
      data: body.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    // `_setCredentials` is not a matter of style: it is how the host learns that
    // it has to persist the new token. Assigning `this.credentials` and nothing
    // else keeps the connection alive for as long as the process lives, and
    // dead after the next restart.
    return this._setCredentials({
      ...this._credentialsFrom(response.data),
      refresh_token: refreshToken,
    });
  }

  _credentialsFrom(data = {}) {
    return {
      access_token: data.access_token || null,
      refresh_token: data.refresh_token || this.credentials.refresh_token || null,
      expires_at: data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : null,
      account_id: data.account_id || this.credentials.account_id || null,
    };
  }

  // ── calls ───────────────────────────────────────────────────────────────

  async _accessToken() {
    const expiresAt = Number(this.credentials.expires_at || 0);
    // One minute of margin: a token that expires while the request is in flight
    // produces a 401 on a random file, halfway through a synchronisation.
    if (!this.credentials.access_token || (expiresAt && Date.now() > expiresAt - 60_000)) {
      await this.refreshCredentials();
    }
    if (!this.credentials.access_token) throw new Error("Dropbox access token is missing.");
    return this.credentials.access_token;
  }

  async _call(endpoint, body = {}) {
    const token = await this._accessToken();
    const response = await this.http({
      method: "POST",
      url: `${API}${endpoint}`,
      data: body,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    return response.data;
  }

  // ── contract ────────────────────────────────────────────────────────────

  async testConnection() {
    try {
      await this._call("/users/get_current_account", null);
      return { ok: true, message: "Dropbox reachable." };
    } catch (err) {
      return { ok: false, message: err?.response?.data?.error_summary || err?.message || "Connection failed." };
    }
  }

  async listFolders(parentId = null) {
    const { entries } = await this._listFolder({ path: toPath(parentId), recursive: false });
    return entries
      .filter((entry) => entry[".tag"] === "folder")
      .map((entry) => ({
        id: entry.path_lower || toPath(entry.path_display),
        name: entry.name,
        parentId: parentPath(entry.path_lower || entry.path_display),
        modifiedAt: null,
      }));
  }

  async listFiles(folderId) {
    const { entries } = await this._listFolder({ path: toPath(folderId), recursive: false });
    return entries.filter(this._isDownloadable).map((entry) => this._normalise(entry));
  }

  async listFilesRecursive(folderId) {
    const { entries } = await this._listFolder({ path: toPath(folderId), recursive: true });
    return entries.filter(this._isDownloadable).map((entry) => this._normalise(entry));
  }

  async downloadFile(fileId, mimeType, _options = {}) {
    const token = await this._accessToken();
    const response = await this.http({
      method: "POST",
      url: `${CONTENT_API}/files/download`,
      data: "",
      responseType: "arraybuffer",
      headers: {
        Authorization: `Bearer ${token}`,
        // The argument travels in a header rather than in the body. That is
        // Dropbox's oddity, and it applies to the content endpoints only.
        "Dropbox-API-Arg": JSON.stringify({ path: fileId }),
        "Content-Type": "text/plain",
      },
    });
    return { buffer: Buffer.from(response.data), mimeType: mimeType || mimeFromName(fileId) };
  }

  async getChanges(cursor = null) {
    if (!cursor) {
      // The first call takes the starting point and nothing else. Listing the
      // whole account here would make the host synchronise the same archive
      // twice, on every connection.
      const data = await this._call("/files/list_folder/get_latest_cursor", {
        path: "", recursive: true, include_deleted: false, include_mounted_folders: true,
      });
      return { changes: [], nextPageToken: data.cursor, isInitial: true };
    }

    const changes = [];
    let current = cursor;
    let hasMore = true;
    while (hasMore) {
      const data = await this._call("/files/list_folder/continue", { cursor: current });
      for (const entry of data.entries || []) {
        if (entry[".tag"] === "deleted") {
          changes.push({ type: "deleted", fileId: entry.path_lower || toPath(entry.path_display) });
        } else if (this._isDownloadable(entry)) {
          changes.push({ type: "updated", fileId: entry.path_lower, file: this._normalise(entry) });
        }
      }
      current = data.cursor || current;
      hasMore = Boolean(data.has_more);
    }
    return { changes, nextPageToken: current, isInitial: false };
  }

  /**
   * On a path-based provider, comparing parents is not enough.
   *
   * The contract's default checks `file.parentId === folder.provider_folder_id`.
   * On Dropbox that means a file in `/documents/2026/` does not belong to
   * `/documents`, and incremental synchronisation never brings anything back
   * from sub-folders. It is the classic mistake of anyone adapting an id-based
   * connector.
   */
  fileBelongsToFolder(file, folder) {
    const folderPath = toPath(folder?.provider_folder_id).toLowerCase();
    const filePath = toPath(file?.pathLower || file?.id).toLowerCase();
    if (!folderPath) return true;
    if (!filePath) return false;
    if (file.parentId === folderPath) return true;
    return Boolean(folder?.recursive) && filePath.startsWith(`${folderPath}/`);
  }

  // ── internals ───────────────────────────────────────────────────────────

  _isDownloadable(entry) {
    return entry[".tag"] === "file" && entry.is_downloadable !== false;
  }

  async _listFolder(args) {
    const entries = [];
    let data = await this._call("/files/list_folder", {
      include_deleted: false,
      include_mounted_folders: true,
      include_non_downloadable_files: false,
      ...args,
    });
    entries.push(...(data.entries || []));
    // Pagination is not optional: a folder with two thousand files arrives in
    // pages of five hundred, and stopping at the first one loses three quarters
    // of it with nothing to signal the loss.
    while (data.has_more) {
      data = await this._call("/files/list_folder/continue", { cursor: data.cursor });
      entries.push(...(data.entries || []));
    }
    return { entries, cursor: data.cursor || null };
  }

  _normalise(entry) {
    const filePath = toPath(entry.path_display || entry.path_lower || entry.id);
    const mimeType = mimeFromName(entry.name);
    return {
      id: entry.path_lower || filePath,
      name: entry.name,
      mimeType,
      size: entry.size ? Number(entry.size) : null,
      checksum: entry.content_hash || null,
      modifiedAt: entry.server_modified || entry.client_modified || null,
      parentId: parentPath(entry.path_lower || filePath),
      webViewLink: null,
      isIndexable: this.isIndexable(mimeType),
      pathLower: entry.path_lower || filePath.toLowerCase(),
      pathDisplay: filePath,
    };
  }
}

module.exports = DropboxProvider;
