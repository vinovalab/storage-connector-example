"use strict";

// What the fixtures contain, told to the conformance suite.
//
// The scenario is not a detail of the tests: it describes the test account, and
// it is what someone writing a new connector has to reproduce on their own
// provider before recording anything. A folder holding **more files than fit in
// one page**, a sub-folder, a file to download, one modification and one
// deletion after a cursor.

module.exports = {
  folders: {
    parentId: null,
    expectedIds: ["/documents"],
  },

  // Files spread over two pages: `has_more: true` on the first one. A connector
  // that reads only the first response finds two of them instead of four.
  files: {
    folderId: "/Documents",
    expectedIds: [
      "/documents/report.pdf",
      "/documents/minutes.docx",
      "/documents/notes.txt",
      "/documents/image.png",
    ],
  },

  recursive: {
    folderId: "/Documents",
    expectedIds: [
      "/documents/report.pdf",
      "/documents/minutes.docx",
      "/documents/notes.txt",
      "/documents/image.png",
      "/documents/2026/invoice.pdf",
    ],
  },

  download: {
    fileId: "/documents/report.pdf",
    mimeType: "application/pdf",
    expectedBytes: 22,
    expectedMimeType: "application/pdf",
  },

  changes: {
    cursor: "cursor-1",
    expectedUpdatedIds: ["/documents/minutes.docx"],
    expectedDeletedIds: ["/documents/notes.txt"],
  },

  // A file inside the sub-folder must be recognised as belonging to the
  // monitored folder. It is the check the contract's default does **not** pass,
  // and the reason this connector overrides `fileBelongsToFolder`.
  folderMatching: {
    file: { id: "/documents/2026/invoice.pdf", pathLower: "/documents/2026/invoice.pdf", parentId: "/documents/2026" },
    folder: { provider_folder_id: "/documents", recursive: true },
    expected: true,
  },

  refresh: {
    expectedAccessToken: "new-token",
  },
};
