# Dropbox connector

OAuth2 with a refresh token, plain HTTP, a cursor for the delta.

**This is the one to imitate.** Most providers — Box, pCloud, Nextcloud, NAS
devices — work like Dropbox: identifiers are paths, not opaque ids, and that
changes one important thing.

## The mistake everyone makes

`fileBelongsToFolder` is overridden. The contract's default compares
`file.parentId` with the monitored folder's id; on a path-based provider that
means `/documents/2026/invoice.pdf` does **not** belong to `/documents`, and
incremental synchronisation never brings anything back from sub-folders. The
defect does not show in a test with files in a single folder.

## Two more things Dropbox does its own way

- The root is the **empty string**, not `/`. With `path: "/"` the first call
  returns a 400 and the error does not say why.
- The download argument travels in the `Dropbox-API-Arg` header, not in the
  body. This applies to the content endpoints only.

## Variables

| key | where to find it |
|---|---|
| `DROPBOX_APP_KEY` | Dropbox console, App key |
| `DROPBOX_APP_SECRET` | Dropbox console, App secret |
| `DROPBOX_REDIRECT_URI` | the callback URL registered in the app |

The authorisation needs `token_access_type=offline`: without it Dropbox issues
no refresh token and the connection dies after four hours.
