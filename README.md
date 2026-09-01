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

Two failures, two causes, and it is worth telling them apart:

| npm says | what happened |
|---|---|
| `404 Not Found — GET https://registry.npmjs.org/@vinovalab%2f…` | **`.npmrc` is missing.** Without it npm does not know the scope lives on GitHub Packages, so it asks the public registry, where the package does not exist. `cp .npmrc.example .npmrc`. |
| `401 Unauthorized` from `npm.pkg.github.com` | `.npmrc` is there, the token is not: paste it in, or export `NODE_AUTH_TOKEN` first. |

**2. The provider tokens — you need none of them for anything on this page.**
App keys, client ids and the account's access and refresh tokens are used only by
`npm run record`, which is how fixtures are produced in the first place.
`.env.example` lists every variable the two connectors declare, with the console
page each value comes from and the two authorisation flags that are forgotten
most often.

`npm run record` reads that file on its own — no exporting needed, that part is
only npm's limitation.

Recording needs three things, and the token is one of them:

1. **The application's variables** — `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`,
   `DROPBOX_REDIRECT_URI` for Dropbox. They identify the app, not the account.
2. **The account's tokens** — `CONNECTOR_ACCESS_TOKEN`, and
   `CONNECTOR_REFRESH_TOKEN` if the connector renews credentials, which
   conformance checks. The Authorise button on the Connection Test page is the
   simplest way to obtain both.
3. **A `scenario.js` that describes your account.** The one shipped describes
   ours: `/Documents` with four files across two pages, a sub-folder, a file to
   download, one renamed and one deleted after a cursor. Recording against an
   account that does not match it produces fixtures conformance then rejects,
   and the failure looks like a broken connector rather than a stale scenario.

Then:

```bash
npm run record -- dropbox
```

The script stops and lists everything missing before making a single call. A
variable set in the shell wins over the file, so one value can be overridden for
a single run without editing anything — that is what this is, not a complete
invocation:

```bash
CONNECTOR_ACCESS_TOKEN=another-one npm run record -- dropbox
```

## The minimal host

The smallest version of `storage-connector-service` that is enough to run a
connector end to end. No database, no authentication, no other service: a
collaborator who has to stand up Postgres to try their own connector never tries
it.

```bash
npm install          # in the repository root
npm start            # the host, on http://localhost:5191

cd web && npm install && npm run dev   # the page, on http://localhost:5190
```

The page is only the host's interface: it proxies `/api` and `/oauth` to it. If
you would rather have one process, `cd web && npm run build` and the host serves
the page itself on 5191.

What it does keep from the real service are the rules, because they are the
reason the contract exists:

- connectors are **discovered by reading the directory**, never a list. A new
  connector is a folder and nothing else;
- the host reads the **manifest**, not the code;
- a connector missing its configuration is **loaded and switched off, with the
  list of what is missing** — not made to disappear;
- refreshed credentials are persisted **once**, after every operation;
- `getChanges(null)` is asked for the starting cursor, and the first full scan is
  the host's job.

### The four steps

**1 · Conformance.** The connector's own suite against its recorded responses.
No account, no network, and none is reachable: the replay transport imports
`fs`, `path` and `crypto`, nothing else. It says whether the connector honours
the contract.

**2 · Authorisation.** Opens the provider's consent page and takes the callback
on the `auth.redirectPath` declared in the manifest. The page says whether a
refresh token came back — without one the connection dies at expiry, silently.

**3 · Connection.** `testConnection` and then `listFolders(null)`. Two calls and
not one: the first can pass with permissions too narrow to read anything, and an
empty listing only shows up when you ask for it.

**4 · Synchronisation.** Pick a folder and run it. The first pass downloads
everything into `.sync/<connector>/` and asks for the starting cursor; the ones
after ask for the delta.

**If the second pass downloads everything again, the connector is wrong** — and
that is the one thing fixtures can never tell you. Conformance checks the *shape*
of `getChanges` against a recording; whether a connector re-reads the whole
archive every night shows up only against a real account.

State — credentials, chosen folder, cursor — lives in `.host-state.json`. It
holds live tokens, so it is git-ignored. That file is where this host and the
real service differ; everything else is the same shape.

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
