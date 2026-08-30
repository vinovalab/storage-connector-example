"use strict";

// Il connettore Google Drive.
//
// **Non usa `googleapis`.** La versione in servizio si appoggia all'SDK, che
// pesa oltre cento megabyte nell'immagine e, soprattutto, fa le richieste per
// conto proprio: un connettore che non passa da `this.http` non si puo
// verificare su risposte registrate, e la sua conformita si potrebbe eseguire
// solo con un account Google vero in mano a chi revisiona.
//
// Le chiamate che servono sono sei, tutte GET tranne il rinnovo del token.
// Scritte a mano stanno in duecento righe e si possono provare offline.
//
// Drive e il caso **particolare**, non il modello: id opachi, cartelle che sono
// file con un mime speciale, e documenti nativi che non si scaricano ma si
// esportano. Chi scrive un connettore nuovo parta da Dropbox.

const { BaseProvider } = require("@vinovalab/storage-connector-contract");

const API = "https://www.googleapis.com/drive/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";

const MIME_CARTELLA = "application/vnd.google-apps.folder";

// I formati nativi e come si esportano. Il download di questi file non
// restituisce il documento: restituisce un errore, ed e per questo che il
// contratto vuole `{ buffer, mimeType }` invece del solo Buffer — il mime del
// contenuto scaricato **non e** quello del file.
const ESPORTAZIONI = {
  "application/vnd.google-apps.document": "application/pdf",
  "application/vnd.google-apps.spreadsheet": "application/pdf",
  "application/vnd.google-apps.presentation": "application/pdf",
  "application/vnd.google-apps.drawing": "image/png",
};

// Cose che stanno in Drive e non sono file: scorciatoie, moduli, mappe, siti.
// Elencarle produrrebbe download falliti a ogni sincronizzazione.
const DA_SALTARE = new Set([
  "application/vnd.google-apps.shortcut",
  MIME_CARTELLA,
  "application/vnd.google-apps.form",
  "application/vnd.google-apps.site",
  "application/vnd.google-apps.map",
]);

const CAMPI_FILE = "id, name, mimeType, size, md5Checksum, modifiedTime, parents, webViewLink";

class GoogleDriveProvider extends BaseProvider {
  static get key() { return "GOOGLE_DRIVE"; }

  constructor(opzioni = {}) {
    super(opzioni);
    this._clientId = this.env.GOOGLE_OAUTH_CLIENT_ID || "";
    this._clientSecret = this.env.GOOGLE_OAUTH_CLIENT_SECRET || "";
    this._redirectUri = this.env.GOOGLE_OAUTH_REDIRECT_URI || "";
  }

  // ── OAuth ───────────────────────────────────────────────────────────────

  getAuthUrl(state) {
    if (!this._clientId) throw new Error("GOOGLE_OAUTH_CLIENT_ID mancante.");
    const qs = new URLSearchParams({
      client_id: this._clientId,
      redirect_uri: this._redirectUri,
      response_type: "code",
      // `offline` per avere il refresh token, `consent` per riaverlo anche
      // quando l'utente ha gia autorizzato: senza, alla seconda connessione
      // Google restituisce solo un access token e la sincronizzazione muore
      // dopo un'ora.
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
    const corpo = new URLSearchParams({
      code,
      client_id: this._clientId,
      client_secret: this._clientSecret,
      redirect_uri: this._redirectUri,
      grant_type: "authorization_code",
    });
    const risposta = await this.http({
      method: "POST",
      url: TOKEN_URL,
      data: corpo.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    return this._credenzialiDa(risposta.data);
  }

  async refreshCredentials() {
    const refreshToken = this.credentials.refresh_token;
    if (!refreshToken) return this.credentials;
    const corpo = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: this._clientId,
      client_secret: this._clientSecret,
      grant_type: "refresh_token",
    });
    const risposta = await this.http({
      method: "POST",
      url: TOKEN_URL,
      data: corpo.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    // Google non rimanda il refresh token nei rinnovi: perderlo qui vorrebbe
    // dire non poter piu rinnovare, e la connessione morirebbe all'ora
    // successiva.
    return this._setCredentials({ ...this._credenzialiDa(risposta.data), refresh_token: refreshToken });
  }

  _credenzialiDa(dati = {}) {
    return {
      access_token: dati.access_token || null,
      refresh_token: dati.refresh_token || this.credentials.refresh_token || null,
      expiry_date: dati.expires_in ? Date.now() + Number(dati.expires_in) * 1000 : null,
      token_type: dati.token_type || "Bearer",
    };
  }

  // ── chiamate ────────────────────────────────────────────────────────────

  async _token() {
    const scadenza = Number(this.credentials.expiry_date || 0);
    if (!this.credentials.access_token || (scadenza && Date.now() > scadenza - 60_000)) {
      await this.refreshCredentials();
    }
    if (!this.credentials.access_token) throw new Error("Access token Google mancante.");
    return this.credentials.access_token;
  }

  async _get(percorso, params = {}, extra = {}) {
    const token = await this._token();
    const risposta = await this.http({
      method: "GET",
      url: `${API}${percorso}`,
      params,
      headers: { Authorization: `Bearer ${token}` },
      ...extra,
    });
    return risposta.data;
  }

  // ── contratto ───────────────────────────────────────────────────────────

  async testConnection() {
    try {
      await this._get("/about", { fields: "user" });
      return { ok: true, message: "Google Drive raggiungibile." };
    } catch (err) {
      return { ok: false, message: err?.response?.data?.error?.message || err?.message || "Connessione fallita." };
    }
  }

  async listFolders(parentId = null) {
    const dati = await this._get("/files", {
      q: `'${parentId || "root"}' in parents and mimeType = '${MIME_CARTELLA}' and trashed = false`,
      fields: "files(id, name, parents, modifiedTime)",
      pageSize: 200,
      orderBy: "name",
    });
    return (dati.files || []).map((f) => ({
      id: f.id,
      name: f.name,
      parentId: (f.parents || [])[0] || null,
      modifiedAt: f.modifiedTime || null,
    }));
  }

  async listFiles(folderId) {
    const fuori = [];
    let pageToken = null;
    do {
      const dati = await this._get("/files", {
        q: `'${folderId}' in parents and trashed = false and mimeType != '${MIME_CARTELLA}'`,
        fields: `nextPageToken, files(${CAMPI_FILE})`,
        pageSize: 1000,
        ...(pageToken ? { pageToken } : {}),
      });
      for (const f of dati.files || []) {
        if (!DA_SALTARE.has(f.mimeType)) fuori.push(this._normalizza(f, folderId));
      }
      pageToken = dati.nextPageToken || null;
    } while (pageToken);
    return fuori;
  }

  async listFilesRecursive(folderId) {
    const file = await this.listFiles(folderId);
    for (const sotto of await this.listFolders(folderId)) {
      file.push(...await this.listFilesRecursive(sotto.id));
    }
    return file;
  }

  async downloadFile(fileId, mimeType, _opzioni = {}) {
    const esportazione = ESPORTAZIONI[mimeType];
    if (esportazione) {
      const dati = await this._get(`/files/${encodeURIComponent(fileId)}/export`, { mimeType: esportazione }, { responseType: "arraybuffer" });
      // Il mime restituito e quello **dell'esportazione**: il chiamante scrive
      // un PDF, non un documento Google.
      return { buffer: Buffer.from(dati), mimeType: esportazione };
    }
    const dati = await this._get(`/files/${encodeURIComponent(fileId)}`, { alt: "media" }, { responseType: "arraybuffer" });
    return { buffer: Buffer.from(dati), mimeType };
  }

  async getChanges(cursor = null) {
    if (!cursor) {
      const dati = await this._get("/changes/startPageToken", {});
      return { changes: [], nextPageToken: dati.startPageToken, isInitial: true };
    }

    const changes = [];
    let corrente = cursor;
    let altro = true;
    while (altro) {
      const dati = await this._get("/changes", {
        pageToken: corrente,
        fields: `nextPageToken, newStartPageToken, changes(fileId, removed, file(${CAMPI_FILE}, trashed))`,
        spaces: "drive",
        includeRemoved: true,
        pageSize: 1000,
      });

      for (const cambiamento of dati.changes || []) {
        // Il cestino e una cancellazione: un file cestinato non si scarica piu,
        // e lasciarlo indicizzato terrebbe in vita un documento che l'utente ha
        // buttato via.
        if (cambiamento.removed || cambiamento.file?.trashed) {
          changes.push({ type: "deleted", fileId: cambiamento.fileId });
        } else if (cambiamento.file && !DA_SALTARE.has(cambiamento.file.mimeType)) {
          changes.push({ type: "updated", fileId: cambiamento.fileId, file: this._normalizza(cambiamento.file) });
        }
      }

      if (dati.newStartPageToken) {
        corrente = dati.newStartPageToken;
        altro = false;
      } else if (dati.nextPageToken) {
        corrente = dati.nextPageToken;
      } else {
        altro = false;
      }
    }
    return { changes, nextPageToken: corrente, isInitial: false };
  }

  _normalizza(f, folderId = null) {
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
      exportMimeType: ESPORTAZIONI[f.mimeType] || null,
    };
  }
}

module.exports = GoogleDriveProvider;
