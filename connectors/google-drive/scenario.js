"use strict";

// Cosa contengono le fixture di Drive.
//
// L'account di prova ha una cartella `Documenti` con dentro: un PDF, un
// documento Google nativo, una scorciatoia (che non deve comparire) e — sulla
// **seconda pagina** — un file di testo. Dentro `Documenti` c'e la
// sotto-cartella `2026` con una fattura.

module.exports = {
  folders: {
    parentId: null,
    expectedIds: ["F-documenti"],
  },

  // La scorciatoia non c'e: Drive la restituisce fra i file, ma non si scarica.
  // Un connettore che la elenca produce un download fallito a ogni giro.
  files: {
    folderId: "F-documenti",
    expectedIds: ["D-relazione", "D-verbale", "D-note"],
  },

  recursive: {
    folderId: "F-documenti",
    expectedIds: ["D-relazione", "D-verbale", "D-note", "D-fattura"],
  },

  download: {
    fileId: "D-relazione",
    mimeType: "application/pdf",
    expectedBytes: 28,
    expectedMimeType: "application/pdf",
  },

  changes: {
    cursor: "12345",
    expectedUpdatedIds: ["D-note"],
    // Due modi diversi di sparire, e per l'host devono essere la stessa cosa:
    // `removed: true` quando il file esce dalla vista dell'utente, e
    // `trashed: true` quando finisce nel cestino.
    expectedDeletedIds: ["D-relazione", "D-sparito"],
  },

  refresh: {
    expectedAccessToken: "nuovo-token",
  },
};
