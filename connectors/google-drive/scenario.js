"use strict";

// What the Drive fixtures contain.
//
// The test account has a `Documents` folder holding a PDF, a native Google
// document, a shortcut (which must not appear) and — on the **second page** — a
// text file. Inside `Documents` there is a `2026` sub-folder with an invoice.

module.exports = {
  folders: {
    parentId: null,
    expectedIds: ["F-documents"],
  },

  // The shortcut is absent: Drive returns it among the files, but it cannot be
  // downloaded. A connector that lists it produces a failed download every run.
  files: {
    folderId: "F-documents",
    expectedIds: ["D-report", "D-minutes", "D-notes"],
  },

  recursive: {
    folderId: "F-documents",
    expectedIds: ["D-report", "D-minutes", "D-notes", "D-invoice"],
  },

  download: {
    fileId: "D-report",
    mimeType: "application/pdf",
    expectedBytes: 22,
    expectedMimeType: "application/pdf",
  },

  // A file deleted after the synchronisation stored its identifier. Drive ids
  // survive renames, but not deletion — and the download happens later.
  missingFile: {
    fileId: "D-deleted",
    mimeType: "application/pdf",
  },

  changes: {
    cursor: "12345",
    expectedUpdatedIds: ["D-notes"],
    // Two different ways of disappearing, and to the host they must be the same
    // thing: `removed: true` when the file leaves the user's view, and
    // `trashed: true` when it goes into the wastebasket.
    expectedDeletedIds: ["D-report", "D-gone"],
  },

  refresh: {
    expectedAccessToken: "new-token",
  },
};
