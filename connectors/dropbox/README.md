# Connettore Dropbox

OAuth2 con refresh token, HTTP puro, cursore per il delta.

**È il modello da imitare.** La maggior parte dei provider — Box, pCloud,
Nextcloud, i NAS — funziona come Dropbox: gli identificatori sono percorsi, non
id opachi, e questo cambia una cosa importante.

## Il punto su cui si sbaglia

`fileBelongsToFolder` è sovrascritto. Il default del contratto confronta
`file.parentId` con l'id della cartella monitorata: su un provider a percorso
significa che `/documenti/2026/fattura.pdf` **non** appartiene a `/documenti`, e
la sincronizzazione incrementale non porta mai niente dalle sotto-cartelle. Il
difetto non si vede in una prova con file in una cartella sola.

## Altre due cose che Dropbox fa a modo suo

- La radice è la **stringa vuota**, non `/`. Con `path: "/"` la prima chiamata
  risponde 400 e l'errore non spiega perché.
- Il parametro del download viaggia nell'header `Dropbox-API-Arg`, non nel
  corpo. Vale solo per gli endpoint di contenuto.

## Variabili

| chiave | dove si trova |
|---|---|
| `DROPBOX_APP_KEY` | console Dropbox, App key |
| `DROPBOX_APP_SECRET` | console Dropbox, App secret |
| `DROPBOX_REDIRECT_URI` | l'URL di callback registrato nell'app |

Nell'autorizzazione serve `token_access_type=offline`: senza, Dropbox non
consegna il refresh token e la connessione muore dopo quattro ore.
