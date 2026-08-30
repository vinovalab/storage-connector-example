# storage-connector-example

Two complete storage connectors — **Google Drive** and **Dropbox** — written
against `@vinovalab/storage-connector-contract`. They are the model for anyone
writing another one: Box, pCloud, Nextcloud, iCloud, a NAS.

Each connector lives in its own repository. When it is finished, its
`connectors/<name>/` directory is copied into `storage-connector-service` and
**nothing else is touched**: no provider list, no OAuth route, no validation, no
interface. Everything is declared in the manifest.

Read the requirements first:
[vinovalab.ai/work-with-us/storage-connectors](https://vinovalab.ai/work-with-us/storage-connectors).

## Writing a connector

1. Copy one of the two directories and rename it. **Start from `dropbox/`**: it
   uses plain HTTP, its identifiers are paths and it has a delta cursor — the
   shape of most providers. `google-drive/` is the exception (opaque ids, native
   documents that must be exported).
2. Rewrite `manifest.js`: key, label, authentication kind, required environment
   variables, capabilities.
3. Rewrite `provider.js`. Every call goes through `this.http` — that is what
   makes it verifiable with no account and no network.
4. Prepare a test account as `scenario.js` describes and record the responses:
   `npm run record -- <directory>`.
5. `npm test`. Until it is green, it is not finished.

```bash
npm install
npm test
```

Installing needs the package token issued with your challenge; put it in an
`.npmrc` (already ignored by git):

```
@vinovalab:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=THE-TOKEN-YOU-RECEIVED
```

## What conformance checks

It is not a formality: these are the ways connectors actually break.

| check | what it prevents |
|---|---|
| `listFiles` paginates to the end | the connector that reads the first response only: fine with ten files, loses three thousand |
| `getChanges(null)` returns only the cursor | the delta that re-reads the whole archive on every run, for ever |
| the cursor advances | synchronisation seeing the same changes endlessly |
| `downloadFile` → `{ buffer, mimeType }` | the bare Buffer, which saves a Google Doc with the wrong extension |
| file and folder shapes | `modified` instead of `modifiedAt`: null dates found weeks later |
| `takeRefreshedCredentials()` | the token renewed in memory and never stored: the connection dies on restart |
| `fileBelongsToFolder` on path providers | sub-folders that never synchronise anything |
| a 429 does not become an empty list | the host reading "folder emptied" and deleting indexed documents |

## The two examples, and why they differ

**`connectors/dropbox/`** — OAuth2 with refresh, plain HTTP, identifiers that
are lowercase paths, a delta cursor, `fileBelongsToFolder` overridden for
recursive matching. It is a faithful port of the connector running in
production, with its calls moved onto `this.http`.

**`connectors/google-drive/`** — OAuth2 with `access_type=offline` and
`prompt=consent`, opaque ids, folders that are files with a special mime type,
native documents that are **exported** rather than downloaded, a wastebasket
that has to be read as a deletion, and a final cursor (`newStartPageToken`)
different from the last `nextPageToken`.

This Drive connector **does not use `googleapis`**: the calls it needs are six,
by hand they fit in two hundred lines, they do not drag a hundred megabytes into
the image and — the part that matters — they go through `this.http`, so they can
be verified offline. A connector that talks to an SDK cannot be verified by
someone who does not hold the account.

> **Before it replaces the version in service:** this Drive connector is
> verified against fixtures, not against a real Google account. The recorded
> responses reproduce the shapes of the v3 API as the production version uses
> them, but the first run on a real account should happen in DEV.

## Fixtures

They are provider responses saved to files. Whoever records them uses real
credentials; whoever reads the code, reviews it, or runs CI uses only the files.

`createRecordingTransport` replaces the sensitive fields it knows about —
`authorization`, `access_token`, `refresh_token`, `client_secret`, passwords,
cookies — including inside URL-encoded bodies. **Read them anyway**: a provider
can put a token where nobody expects it.

The fixtures in this repository are written by hand against the documented APIs,
because the accounts they describe are not ours to hand around. That is
acceptable — faithful is what matters, recorded or not — but a fixture invented
to make a check pass is not.

## Layout

```
connectors/<name>/
  manifest.js          identity, authentication, required config, capabilities
  provider.js          the class that extends BaseProvider
  scenario.js          what the fixtures contain: files, folders, changes
  fixtures/*.json      the recorded responses
  conformance.test.js  conformance plus the checks specific to the provider
```

That directory, and only that directory, is what gets copied into the service.
