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

## Getting started

```bash
git clone https://github.com/vinovalab/storage-connector-example.git
cd storage-connector-example
npm install
npm test
```

Forty-five checks run offline, against recorded responses. If they are green the
repository is working and you need no account to go on.

### Where the tokens go

There are **two different tokens**, and confusing them wastes an afternoon.

**1. The package token — this is the one you need to run anything.**
`@vinovalab/storage-connector-contract` is published to GitHub Packages, not to
the public registry, so `npm install` fails with a `401` without it. It is the
token issued with your challenge. Put it in an `.npmrc` in the repository root
(`.npmrc` is already in `.gitignore`, so it cannot be committed by accident):

```
@vinovalab:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=THE-TOKEN-YOU-RECEIVED
```

The same file works in `~/.npmrc` if you would rather keep one copy for every
repository.

**2. The provider tokens — not needed for anything below.** `DROPBOX_APP_KEY`,
`GOOGLE_OAUTH_CLIENT_ID`, an access token and a refresh token are needed only by
`npm run record`, which is how fixtures are produced in the first place. They are
passed as environment variables on that one command, never written into a file
in the repository:

```bash
GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... \
GOOGLE_OAUTH_REDIRECT_URI=... \
CONNECTOR_ACCESS_TOKEN=... CONNECTOR_REFRESH_TOKEN=... \
npm run record -- google-drive
```

If you prefer a file, `.env` and `.env.*` are ignored by git too. Each
connector's own README lists the variables it needs and where to obtain them.

## The Connection Test page

A one-page tool to run both connectors without a terminal:

```bash
npm install          # in the repository root — see below
cd web
npm install
npm run dev
```

Then open <http://localhost:5190>.

**The install in the root is not optional**, and it is the one people skip: each
connector's `manifest.js` imports the contract package, so without the root
`node_modules` the page loads but every connector shows an error instead of its
capabilities.

You get one button per directory under `connectors/` — `dropbox` and
`google-drive`. Pressing it runs that connector's `conformance.test.js`, the same
suite `npm test` runs rather than a second implementation of the checks, and
shows what passed, what failed and the full output.

**No login, and no provider token.** Every call a connector makes goes through
`this.http`, and the responses are recorded in its fixtures: the page needs no
account, no credentials and no network. The only token involved is the package
one, and it was already spent at install time.

The two endpoints live inside the Vite dev server, because a connector is a Node
module and the browser cannot run it. `npm run build` produces a page with no
backend behind it: this is a development tool, so use `npm run dev`.

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
| a vanished file surfaces as `fileNotFound` | a renamed file marked permanently broken, or an empty download reaching the index |
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

web/                   the Connection Test page (development tool, not shipped)
```

That directory, and only that directory, is what gets copied into the service.
