"use strict";

// Il giro completo: e questo che nessuna fixture puo verificare.
//
// La conformita controlla la **forma** di getChanges contro risposte
// registrate. Non puo dire che il connettore non riscarichi l'intero archivio a
// ogni sincronizzazione: quello si vede solo con un account vero, ed e uno dei
// tre errori che il contratto esiste per prevenire.
//
// La regola, dal contratto: `getChanges(null)` **non** elenca tutto. Restituisce
// il cursore di partenza e `isInitial: true`. La scansione completa la fa
// l'ospite, la prima volta e una volta sola; un connettore che risponde con
// tutto la fa fare due volte.
//
// Quindi:
//   primo giro   → scansione completa + getChanges(null) per il cursore
//   giri seguenti→ getChanges(cursore) → scarica i modificati, toglie i tolti

const fs = require("fs");
const path = require("path");
const { costruisci, persistiRinnovo } = require("./provider");
const stato = require("./state");

const DESTINAZIONE = path.join(__dirname, "..", ".sync");

function percorsoLocale(dir, file) {
  // L'identificatore puo essere un percorso (Dropbox) o opaco (Drive): in
  // entrambi i casi si appiattisce in un nome di file, perche qui interessa
  // vedere che il contenuto e arrivato, non ricostruire l'albero.
  const nome = String(file.name || file.id).replace(/[^\w.\-]+/g, "_").slice(-120);
  return path.join(DESTINAZIONE, dir, `${nome}`);
}

async function scarica(dir, provider, file, esito) {
  try {
    const { buffer, mimeType } = await provider.downloadFile(file.id, file.mimeType, {});
    const destinazione = percorsoLocale(dir, file);
    fs.mkdirSync(path.dirname(destinazione), { recursive: true });
    fs.writeFileSync(destinazione, buffer);
    esito.scaricati.push({ id: file.id, name: file.name ?? null, bytes: buffer.length, mimeType });
  } catch (errore) {
    esito.errori.push({ id: file.id, messaggio: errore?.message || String(errore) });
  }
}

async function sincronizza(dir, { folderId }) {
  const inizio = Date.now();
  const { provider, manifest } = costruisci(dir);
  const connessione = stato.connessione(dir) || {};
  const cursorePrecedente = connessione.cursor || null;

  const esito = {
    modo: cursorePrecedente ? "incrementale" : "completo",
    folderId,
    scaricati: [],
    rimossi: [],
    errori: [],
    cursorePrecedente,
    cursore: null,
    credenzialiRinnovate: false,
  };

  try {
    if (!cursorePrecedente) {
      // Prima volta: la scansione la fa l'ospite.
      const elenca = manifest.capabilities?.deltaSync !== false && typeof provider.listFilesRecursive === "function"
        ? provider.listFilesRecursive.bind(provider)
        : provider.listFiles.bind(provider);
      const file = await elenca(folderId);
      esito.trovati = (file || []).length;
      for (const f of file || []) await scarica(dir, provider, f, esito);

      // E poi il cursore di partenza, che NON elenca nulla.
      if (manifest.capabilities?.deltaSync) {
        const partenza = await provider.getChanges(null);
        esito.cursore = partenza?.nextPageToken ?? null;
        esito.isInitial = partenza?.isInitial === true;
        if (Array.isArray(partenza?.changes) && partenza.changes.length > 0) {
          // Va detto: e l'errore che raddoppia ogni prima sincronizzazione.
          esito.avvisi = [
            `getChanges(null) ha restituito ${partenza.changes.length} modifiche. Il contratto vuole che `
            + "restituisca solo il cursore di partenza: la scansione completa la fa l'ospite, e cosi la fa due volte.",
          ];
        }
      }
    } else {
      const delta = await provider.getChanges(cursorePrecedente);
      esito.cursore = delta?.nextPageToken ?? cursorePrecedente;
      const modifiche = Array.isArray(delta?.changes) ? delta.changes : [];
      esito.viste = modifiche.length;

      for (const modifica of modifiche) {
        const appartiene = provider.fileBelongsToFolder(
          modifica.file || modifica,
          { provider_folder_id: folderId, recursive: true },
        );
        if (!appartiene) continue;

        if (modifica.type === "deleted" || modifica.deleted) {
          const destinazione = percorsoLocale(dir, modifica.file || modifica);
          if (fs.existsSync(destinazione)) fs.unlinkSync(destinazione);
          esito.rimossi.push({ id: (modifica.file || modifica).id });
        } else {
          await scarica(dir, provider, modifica.file || modifica, esito);
        }
      }
    }

    esito.credenzialiRinnovate = persistiRinnovo(dir, provider);
    stato.salvaConnessione(dir, { cursor: esito.cursore, folderId, ultimaSync: new Date().toISOString() });
    esito.ok = true;
  } catch (errore) {
    // Anche in errore le credenziali rinnovate vanno salvate: il rinnovo puo
    // essere riuscito e la chiamata successiva no, e ripeterlo brucia il
    // refresh token dei provider che lo ruotano.
    esito.credenzialiRinnovate = persistiRinnovo(dir, provider);
    esito.ok = false;
    esito.errore = errore?.message || String(errore);
  }

  esito.durata = Date.now() - inizio;
  return esito;
}

module.exports = { sincronizza, DESTINAZIONE };
