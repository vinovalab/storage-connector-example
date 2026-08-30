"use strict";

// Cosa contengono le fixture, detto all'host della conformita.
//
// Lo scenario non e un dettaglio del test: e la descrizione dell'account di
// prova, ed e quello che chi scrive un connettore nuovo deve ricreare sul
// proprio provider prima di registrare le risposte. Una cartella con **piu
// file di quanti ne stiano in una pagina**, una sotto-cartella, un file da
// scaricare, una modifica e una cancellazione dopo un cursore.

module.exports = {
  folders: {
    parentId: null,
    expectedIds: ["/documenti"],
  },

  // Cinque file su due pagine: `has_more: true` sulla prima. Un connettore che
  // legge solo la prima risposta ne troverebbe due invece di quattro.
  files: {
    folderId: "/Documenti",
    expectedIds: [
      "/documenti/relazione.pdf",
      "/documenti/verbale.docx",
      "/documenti/note.txt",
      "/documenti/immagine.png",
    ],
  },

  recursive: {
    folderId: "/Documenti",
    expectedIds: [
      "/documenti/relazione.pdf",
      "/documenti/verbale.docx",
      "/documenti/note.txt",
      "/documenti/immagine.png",
      "/documenti/2026/fattura.pdf",
    ],
  },

  download: {
    fileId: "/documenti/relazione.pdf",
    mimeType: "application/pdf",
    expectedBytes: 28,
    expectedMimeType: "application/pdf",
  },

  changes: {
    cursor: "cursor-1",
    expectedUpdatedIds: ["/documenti/verbale.docx"],
    expectedDeletedIds: ["/documenti/note.txt"],
  },

  // Un file dentro la sotto-cartella deve risultare appartenente alla cartella
  // monitorata: e il controllo che il default del contratto **non** supera, e
  // per cui questo connettore sovrascrive `fileBelongsToFolder`.
  folderMatching: {
    file: { id: "/documenti/2026/fattura.pdf", pathLower: "/documenti/2026/fattura.pdf", parentId: "/documenti/2026" },
    folder: { provider_folder_id: "/documenti", recursive: true },
    expected: true,
  },

  refresh: {
    expectedAccessToken: "nuovo-token",
  },
};
