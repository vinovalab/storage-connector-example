"use strict";

// Il connettore Dropbox.
//
// E' il modello da imitare per chi ne scrive uno nuovo: nessun SDK, solo
// chiamate HTTP dentro `this.http`, identificatori che sono percorsi, cursore
// per il delta. Box, pCloud, Nextcloud e la maggior parte dei NAS funzionano
// cosi; Google Drive, con i suoi id opachi e i formati da esportare, e il caso
// particolare.

const path = require("path");
const { BaseProvider } = require("@vinovalab/storage-connector-contract");

const API = "https://api.dropboxapi.com/2";
const CONTENT_API = "https://content.dropboxapi.com/2";
const AUTHORIZE_URL = "https://www.dropbox.com/oauth2/authorize";
const TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";

// Dropbox non dice il mime type: lo si deduce dall'estensione. L'elenco resta
// corto di proposito — e la stessa domanda a cui risponde `isIndexable` del
// contratto, e allungarlo qui senza allungarlo li produrrebbe file scaricati e
// mai indicizzati.
const MIME_PER_ESTENSIONE = {
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

// La radice per Dropbox e la stringa vuota, non "/": e l'unico posto dove le
// due cose si distinguono, e sbagliarlo produce un 400 sulla prima chiamata.
function percorso(valore) {
  if (!valore || valore === "/") return "";
  return String(valore).startsWith("/") ? String(valore) : `/${valore}`;
}

function percorsoGenitore(valore) {
  const normalizzato = percorso(valore);
  if (!normalizzato) return "";
  const taglio = normalizzato.lastIndexOf("/");
  return taglio <= 0 ? "" : normalizzato.slice(0, taglio).toLowerCase();
}

const mimeDi = (nome) => MIME_PER_ESTENSIONE[path.extname(String(nome || "")).toLowerCase()] || "application/octet-stream";

class DropboxProvider extends BaseProvider {
  static get key() { return "DROPBOX"; }

  constructor(opzioni = {}) {
    super(opzioni);
    this._clientId = this.env.DROPBOX_APP_KEY || "";
    this._clientSecret = this.env.DROPBOX_APP_SECRET || "";
    this._redirectUri = this.env.DROPBOX_REDIRECT_URI || "";
  }

  // ── OAuth ───────────────────────────────────────────────────────────────

  getAuthUrl(state) {
    if (!this._clientId) throw new Error("DROPBOX_APP_KEY mancante.");
    const qs = new URLSearchParams({
      client_id: this._clientId,
      response_type: "code",
      // Senza `offline` Dropbox non consegna il refresh token e la connessione
      // muore dopo quattro ore, quando nessuno sta guardando.
      token_access_type: "offline",
      state,
    });
    if (this._redirectUri) qs.set("redirect_uri", this._redirectUri);
    return `${AUTHORIZE_URL}?${qs.toString()}`;
  }

  async exchangeCode(code) {
    const corpo = new URLSearchParams({
      code,
      grant_type: "authorization_code",
      client_id: this._clientId,
      client_secret: this._clientSecret,
    });
    if (this._redirectUri) corpo.set("redirect_uri", this._redirectUri);
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
      grant_type: "refresh_token",
      client_id: this._clientId,
      client_secret: this._clientSecret,
    });
    const risposta = await this.http({
      method: "POST",
      url: TOKEN_URL,
      data: corpo.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    // `_setCredentials` non e un dettaglio di stile: e cosi che l'host viene a
    // sapere che deve persistere il nuovo token. Assegnare `this.credentials`
    // e basta lascia la connessione viva finche il processo vive, e morta al
    // riavvio successivo.
    return this._setCredentials({
      ...this._credenzialiDa(risposta.data),
      refresh_token: refreshToken,
    });
  }

  _credenzialiDa(dati = {}) {
    return {
      access_token: dati.access_token || null,
      refresh_token: dati.refresh_token || this.credentials.refresh_token || null,
      expires_at: dati.expires_in ? Date.now() + Number(dati.expires_in) * 1000 : null,
      account_id: dati.account_id || this.credentials.account_id || null,
    };
  }

  // ── chiamate ────────────────────────────────────────────────────────────

  async _token() {
    const scadenza = Number(this.credentials.expires_at || 0);
    // Un minuto di margine: un token che scade mentre la richiesta viaggia
    // produce un 401 su un file a caso, in mezzo a una sincronizzazione.
    if (!this.credentials.access_token || (scadenza && Date.now() > scadenza - 60_000)) {
      await this.refreshCredentials();
    }
    if (!this.credentials.access_token) throw new Error("Access token Dropbox mancante.");
    return this.credentials.access_token;
  }

  async _chiama(endpoint, corpo = {}) {
    const token = await this._token();
    const risposta = await this.http({
      method: "POST",
      url: `${API}${endpoint}`,
      data: corpo,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    return risposta.data;
  }

  // ── contratto ───────────────────────────────────────────────────────────

  async testConnection() {
    try {
      await this._chiama("/users/get_current_account", null);
      return { ok: true, message: "Dropbox raggiungibile." };
    } catch (err) {
      return { ok: false, message: err?.response?.data?.error_summary || err?.message || "Connessione fallita." };
    }
  }

  async listFolders(parentId = null) {
    const { entries } = await this._elencaCartella({ path: percorso(parentId), recursive: false });
    return entries
      .filter((voce) => voce[".tag"] === "folder")
      .map((voce) => ({
        id: voce.path_lower || percorso(voce.path_display),
        name: voce.name,
        parentId: percorsoGenitore(voce.path_lower || voce.path_display),
        modifiedAt: null,
      }));
  }

  async listFiles(folderId) {
    const { entries } = await this._elencaCartella({ path: percorso(folderId), recursive: false });
    return entries.filter(this._scaricabile).map((voce) => this._normalizza(voce));
  }

  async listFilesRecursive(folderId) {
    const { entries } = await this._elencaCartella({ path: percorso(folderId), recursive: true });
    return entries.filter(this._scaricabile).map((voce) => this._normalizza(voce));
  }

  async downloadFile(fileId, mimeType, _opzioni = {}) {
    const token = await this._token();
    const risposta = await this.http({
      method: "POST",
      url: `${CONTENT_API}/files/download`,
      data: "",
      responseType: "arraybuffer",
      headers: {
        Authorization: `Bearer ${token}`,
        // Il parametro viaggia in un header, non nel corpo: e la stranezza di
        // Dropbox, e vale solo per gli endpoint di contenuto.
        "Dropbox-API-Arg": JSON.stringify({ path: fileId }),
        "Content-Type": "text/plain",
      },
    });
    return { buffer: Buffer.from(risposta.data), mimeType: mimeType || mimeDi(fileId) };
  }

  async getChanges(cursor = null) {
    if (!cursor) {
      // Alla prima chiamata si prende **solo** il punto di partenza: elencare
      // qui tutto il contenuto farebbe sincronizzare all'host due volte lo
      // stesso archivio.
      const dati = await this._chiama("/files/list_folder/get_latest_cursor", {
        path: "", recursive: true, include_deleted: false, include_mounted_folders: true,
      });
      return { changes: [], nextPageToken: dati.cursor, isInitial: true };
    }

    const changes = [];
    let corrente = cursor;
    let altro = true;
    while (altro) {
      const dati = await this._chiama("/files/list_folder/continue", { cursor: corrente });
      for (const voce of dati.entries || []) {
        if (voce[".tag"] === "deleted") {
          changes.push({ type: "deleted", fileId: voce.path_lower || percorso(voce.path_display) });
        } else if (this._scaricabile(voce)) {
          changes.push({ type: "updated", fileId: voce.path_lower, file: this._normalizza(voce) });
        }
      }
      corrente = dati.cursor || corrente;
      altro = Boolean(dati.has_more);
    }
    return { changes, nextPageToken: corrente, isInitial: false };
  }

  /**
   * Su un provider a percorso il confronto fra genitori non basta.
   *
   * Il default del contratto guarda `file.parentId === folder.provider_folder_id`:
   * su Dropbox vuol dire che un file dentro `/Documenti/2026/` non appartiene a
   * `/Documenti`, e la sincronizzazione incrementale non porta mai niente dalle
   * sotto-cartelle. E' l'errore piu comune di chi copia un connettore a id.
   */
  fileBelongsToFolder(file, folder) {
    const cartella = percorso(folder?.provider_folder_id).toLowerCase();
    const percorsoFile = percorso(file?.pathLower || file?.id).toLowerCase();
    if (!cartella) return true;
    if (!percorsoFile) return false;
    if (file.parentId === cartella) return true;
    return Boolean(folder?.recursive) && percorsoFile.startsWith(`${cartella}/`);
  }

  // ── interno ─────────────────────────────────────────────────────────────

  _scaricabile(voce) {
    return voce[".tag"] === "file" && voce.is_downloadable !== false;
  }

  async _elencaCartella(argomenti) {
    const entries = [];
    let dati = await this._chiama("/files/list_folder", {
      include_deleted: false,
      include_mounted_folders: true,
      include_non_downloadable_files: false,
      ...argomenti,
    });
    entries.push(...(dati.entries || []));
    // La paginazione non e facoltativa: una cartella con duemila file arriva in
    // pagine da cinquecento, e chi si ferma alla prima ne perde tre quarti
    // senza che niente lo segnali.
    while (dati.has_more) {
      dati = await this._chiama("/files/list_folder/continue", { cursor: dati.cursor });
      entries.push(...(dati.entries || []));
    }
    return { entries, cursor: dati.cursor || null };
  }

  _normalizza(voce) {
    const percorsoFile = percorso(voce.path_display || voce.path_lower || voce.id);
    const mimeType = mimeDi(voce.name);
    return {
      id: voce.path_lower || percorsoFile,
      name: voce.name,
      mimeType,
      size: voce.size ? Number(voce.size) : null,
      checksum: voce.content_hash || null,
      modifiedAt: voce.server_modified || voce.client_modified || null,
      parentId: percorsoGenitore(voce.path_lower || percorsoFile),
      webViewLink: null,
      isIndexable: this.isIndexable(mimeType),
      pathLower: voce.path_lower || percorsoFile.toLowerCase(),
      pathDisplay: percorsoFile,
    };
  }
}

module.exports = DropboxProvider;
