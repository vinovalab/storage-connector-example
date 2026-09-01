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

Two files, both in the repository root, and neither of them is for you to invent:
each one has a template committed beside it. Copy it and fill it in.

```bash
cp .npmrc.example .npmrc     # the package token — needed to install anything
cp .env.example .env         # the rest — only to record fixtures
```

`.env` and `.npmrc` are ignored by git; `.env.example` and `.npmrc.example` are
committed. That takes an explicit negation in `.gitignore`, because the `.env.*`
rule would otherwise swallow `.env.example` and no one would notice until a new
arrival had nothing to copy.

**1. The package token — `NODE_AUTH_TOKEN`. This is the one you need to run
anything.** It is available at
[collaborators.vinovalab.ai](https://collaborators.vinovalab.ai), in the details
of your challenge, and it needs `read:packages`.
`@vinovalab/storage-connector-contract` is published to GitHub Packages, not to
the public registry, so `npm install` fails with a `401` without it.

There are two ways to supply it, and `.npmrc.example` supports both. The short
one is to paste the token into `.npmrc` and forget about it. The other is to
keep it in `.env` as `NODE_AUTH_TOKEN` and export it before installing, which is
what you want when the same value also has to reach a Docker build or a CI job:

```bash
set -a; . ./.env; set +a
npm install
```

**npm does not read `.env` by itself**, and the failure is unhelpful: with
`${NODE_AUTH_TOKEN}` left in `.npmrc` and the variable never exported, npm does
not complain — it sends the literal text to the registry, and the 401 reads like
a bad token rather than a missing variable.

**2. The provider tokens — you need none of them for anything on this page.**
App keys, client ids and the account's access and refresh tokens are used only by
`npm run record`, which is how fixtures are produced in the first place.
`.env.example` lists every variable the two connectors declare, with the console
page each value comes from and the two authorisation flags that are forgotten
most often.

`npm run record` reads that file on its own — no exporting needed, that part is
only npm's limitation. A variable set in the shell wins over the file, so one
value can be overridden for a single run without editing anything:

```bash
CONNECTOR_ACCESS_TOKEN=another-one npm run record -- dropbox
```

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

.npmrc.example         template for the package token — copy to .npmrc
.env.example           template for the provider tokens — copy to .env
```

That directory, and only that directory, is what gets copied into the service.
