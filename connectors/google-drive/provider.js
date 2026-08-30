"use strict";

// The Google Drive connector.
//
// **It does not use `googleapis`.** The version currently in service relies on
// the SDK, which weighs over a hundred megabytes in the image and, more
// importantly, makes its own requests: a connector that does not go through
// `this.http` cannot be verified against recorded responses, and its conformance
// could only be run by a reviewer holding a real Google account.
//
// The calls it needs are six, all GET except the token refresh. Written by hand
// they fit in two hundred lines and can be exercised offline.
//
// Drive is the **exception**, not the model: opaque ids, folders that are files
// with a special mime type, and native documents that are exported rather than
// downloaded. Anyone writing a new connector should start from Dropbox.

const { BaseProvider } = require("@vinovalab/storage-connector-contract");

const API = "https://www.googleapis.com/drive/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";

const FOLDER_MIME = "application/vnd.google-apps.folder";

// The native formats and how they are exported. Downloading one of these files
// does not return the document, it returns an error — which is why the contract
// asks for `{ buffer, mimeType }` instead of a bare Buffer: the mime type of
// what you downloaded is **not** the mime type of the file.
const EXPORTS = {
  "application/vnd.google-apps.document": "application/pdf",
  "application/vnd.google-apps.spreadsheet": "application/pdf",
  "application/vnd.google-apps.presentation": "application/pdf",
  "application/vnd.google-apps.drawing": "image/png",
};

// Things that live in Drive and are not files: shortcuts, forms, maps, sites.
// Listing them produces a failed download on every synchronisation.
const SKIP = new Set([
  "application/vnd.google-apps.shortcut",
  FOLDER_MIME,
  "application/vnd.google-apps.form",
  "application/vnd.google-apps.site",
  "application/vnd.google-apps.map",
]);

const FILE_FIELDS = "id, name, mimeType, size, md5Checksum, modifiedTime, parents, webViewLink";

class GoogleDriveProvider extends BaseProvider {
  static get key() { return "GOOGLE_DRIVE"; }

  constructor(options = {}) {
    super(options);
    this._clientId = this.env.GOOGLE_OAUTH_CLIENT_ID || "";
    this._clientSecret = this.env.GOOGLE_OAUTH_CLIENT_SECRET || "";
    this._redirectUri = this.env.GOOGLE_OAUTH_REDIRECT_URI || "";
  }

  // ── OAuth ───────────────────────────────────────────────────────────────

  getAuthUrl(state) {
    if (!this._clientId) throw new Error("GOOGLE_OAUTH_CLIENT_ID is missing.");
    const qs = new URLSearchParams({
      client_id: this._clientId,
      redirect_uri: this._redirectUri,
      response_type: "code",
      // `offline` to receive a refresh token, `consent` to receive it again on
      // an account that has already authorised us. Without the second one, the
      // second connection gets an access token only and synchronisation dies an
      // hour later.
      access_type: "offline",
      prompt: "consent",
      scope: [
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/drive.metadata.readonly",
      ].join(" "),
      state,
    });
    return `${AUTHORIZE_URL}?${qs.toString()}`;
  }

  async exchangeCode(code) {
    const body = new URLSearchParams({
      code,
      client_id: this._clientId,
      client_secret: this._clientSecret,
      redirect_uri: this._redirectUri,
      grant_type: "authorization_code",
    });
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
      client_id: this._clientId,
      client_secret: this._clientSecret,
      grant_type: "refresh_token",
    });
    const response = await this.http({
      method: "POST",
      url: TOKEN_URL,
      data: body.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    // Google never returns the refresh token on a renewal: losing it here means
    // never being able to renew again, and the connection dies within the hour.
    return this._setCredentials({ ...this._credentialsFrom(response.data), refresh_token: refreshToken });
  }

  _credentialsFrom(data = {}) {
    return {
      access_token: data.access_token || null,
      refresh_token: data.refresh_token || this.credentials.refresh_token || null,
      expiry_date: data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : null,
      token_type: data.token_type || "Bearer",
    };
  }

  // ── calls ───────────────────────────────────────────────────────────────

  async _accessToken() {
    const expiresAt = Number(this.credentials.expiry_date || 0);
    if (!this.credentials.access_token || (expiresAt && Date.now() > expiresAt - 60_000)) {
      await this.refreshCredentials();
    }
    if (!this.credentials.access_token) throw new Error("Google access token is missing.");
    return this.credentials.access_token;
  }

  async _get(path, params = {}, extra = {}) {
    const token = await this._accessToken();
    const response = await this.http({
      method: "GET",
      url: `${API}${path}`,
      params,
      headers: { Authorization: `Bearer ${token}` },
      ...extra,
    });
    return response.data;
  }

  // ── contract ────────────────────────────────────────────────────────────

  async testConnection() {
    try {
      await this._get("/about", { fields: "user" });
      return { ok: true, message: "Google Drive reachable." };
    } catch (err) {
      return { ok: false, message: err?.response?.data?.error?.message || err?.message || "Connection failed." };
    }
  }

  async listFolders(parentId = null) {
    const data = await this._get("/files", {
      q: `'${parentId || "root"}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
      fields: "files(id, name, parents, modifiedTime)",
      pageSize: 200,
      orderBy: "name",
    });
    return (data.files || []).map((f) => ({
      id: f.id,
      name: f.name,
      parentId: (f.parents || [])[0] || null,
      modifiedAt: f.modifiedTime || null,
    }));
  }

  async listFiles(folderId) {
    const out = [];
    let pageToken = null;
    do {
      const data = await this._get("/files", {
        q: `'${folderId}' in parents and trashed = false and mimeType != '${FOLDER_MIME}'`,
        fields: `nextPageToken, files(${FILE_FIELDS})`,
        pageSize: 1000,
        ...(pageToken ? { pageToken } : {}),
      });
      for (const f of data.files || []) {
        if (!SKIP.has(f.mimeType)) out.push(this._normalise(f, folderId));
      }
      pageToken = data.nextPageToken || null;
    } while (pageToken);
    return out;
  }

  async listFilesRecursive(folderId) {
    const files = await this.listFiles(folderId);
    for (const sub of await this.listFolders(folderId)) {
      files.push(...await this.listFilesRecursive(sub.id));
    }
    return files;
  }

  async downloadFile(fileId, mimeType, _options = {}) {
    const exportAs = EXPORTS[mimeType];
    if (exportAs) {
      const data = await this._get(`/files/${encodeURIComponent(fileId)}/export`, { mimeType: exportAs }, { responseType: "arraybuffer" });
      // The mime type returned is the **export's**: the caller writes a PDF, not
      // a Google document.
      return { buffer: Buffer.from(data), mimeType: exportAs };
    }
    const data = await this._get(`/files/${encodeURIComponent(fileId)}`, { alt: "media" }, { responseType: "arraybuffer" });
    return { buffer: Buffer.from(data), mimeType };
  }

  async getChanges(cursor = null) {
    if (!cursor) {
      const data = await this._get("/changes/startPageToken", {});
      return { changes: [], nextPageToken: data.startPageToken, isInitial: true };
    }

    const changes = [];
    let current = cursor;
    let hasMore = true;
    while (hasMore) {
      const data = await this._get("/changes", {
        pageToken: current,
        fields: `nextPageToken, newStartPageToken, changes(fileId, removed, file(${FILE_FIELDS}, trashed))`,
        spaces: "drive",
        includeRemoved: true,
        pageSize: 1000,
      });

      for (const change of data.changes || []) {
        // The wastebasket is a deletion: a trashed file can no longer be
        // downloaded, and leaving it indexed keeps alive a document the user
        // threw away.
        if (change.removed || change.file?.trashed) {
          changes.push({ type: "deleted", fileId: change.fileId });
        } else if (change.file && !SKIP.has(change.file.mimeType)) {
          changes.push({ type: "updated", fileId: change.fileId, file: this._normalise(change.file) });
        }
      }

      if (data.newStartPageToken) {
        current = data.newStartPageToken;
        hasMore = false;
      } else if (data.nextPageToken) {
        current = data.nextPageToken;
      } else {
        hasMore = false;
      }
    }
    return { changes, nextPageToken: current, isInitial: false };
  }

  _normalise(f, folderId = null) {
    return {
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: f.size ? Number(f.size) : null,
      checksum: f.md5Checksum || null,
      modifiedAt: f.modifiedTime || null,
      parentId: folderId || (f.parents || [])[0] || null,
      webViewLink: f.webViewLink || null,
      isIndexable: this.isIndexable(f.mimeType),
      exportMimeType: EXPORTS[f.mimeType] || null,
    };
  }
}

module.exports = GoogleDriveProvider;
