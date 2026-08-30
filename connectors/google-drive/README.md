# Google Drive connector

OAuth2, opaque ids, native documents that must be exported. **This is the
exception**: anyone writing a new connector should start from `dropbox/`.

## Without `googleapis`

The calls it needs are six — `about`, `files.list`, download, export,
`changes/startPageToken`, `changes` — plus the token refresh. Written by hand
they fit in two hundred lines, they do not drag a hundred megabytes of SDK into
the image, and — this is the part that matters — they go through `this.http`,
which is what makes the connector verifiable against recorded responses without
a Google account.

> Verified against fixtures, not against a real account: the first run on a real
> Drive should happen in DEV before this replaces the version in service.

## The three traps

- **Native documents are not downloaded.** A Google Doc has to be exported, and
  what you get is a PDF: the mime type of the content is **not** the mime type
  of the file. This is why the contract asks for `{ buffer, mimeType }`.
- **The wastebasket is a deletion.** Google does not say "removed" for a trashed
  file: it says the file changed, with `trashed: true`. Treating that as a
  modification keeps a document the user threw away in the index.
- **The final cursor is `newStartPageToken`**, not the last `nextPageToken`.
  Storing the wrong one replays the same changes for ever.

Shortcuts, forms, maps and sites are skipped: they live in Drive, they have no
content, and downloading them fails on every run.

A fourth one is not specific to Drive but bites here too: the download happens
long after the synchronisation that stored the id, and by then the file may have
been deleted. Drive answers 404; the connector turns that into `fileNotFound()`
from the contract, so the host can schedule a re-discovery instead of marking the
document broken for good.

## Variables

| key | where to find it |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | Google Cloud Console, OAuth credentials |
| `GOOGLE_OAUTH_CLIENT_SECRET` | same place |
| `GOOGLE_OAUTH_REDIRECT_URI` | an authorised redirect URI in the project |

The authorisation needs `access_type=offline` **and** `prompt=consent`: without
the second one, a second connection gets no refresh token from Google and
synchronisation dies after an hour.
