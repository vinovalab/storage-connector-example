# Connettore Google Drive

OAuth2, id opachi, documenti nativi da esportare. **È il caso particolare**: chi
scrive un connettore nuovo parta da `dropbox/`.

## Senza `googleapis`

Le chiamate che servono sono sei — `about`, `files.list`, download, export,
`changes/startPageToken`, `changes` — più il rinnovo del token. Scritte a mano
stanno in duecento righe, non trascinano cento megabyte nell'immagine, e passano
da `this.http`: è quest'ultima cosa che permette di verificare il connettore su
risposte registrate, senza un account Google.

> Verificato sulle fixture, non contro un account reale: il primo giro su Drive
> vero va fatto in DEV prima di sostituire la versione in servizio.

## Le tre trappole

- **I documenti nativi non si scaricano.** Un Documento Google va esportato, e
  ciò che si ottiene è un PDF: il mime del contenuto **non** è il mime del file.
  È la ragione per cui il contratto vuole `{ buffer, mimeType }`.
- **Il cestino è una cancellazione.** Google non dice «rimosso» per un file
  cestinato: dice che è cambiato, con `trashed: true`. Trattarlo come modifica
  tiene indicizzato un documento che l'utente ha buttato via.
- **Il cursore finale è `newStartPageToken`**, non l'ultimo `nextPageToken`.
  Salvare quello sbagliato fa rileggere gli stessi cambiamenti per sempre.

Le scorciatoie, i moduli, le mappe e i siti si saltano: stanno in Drive, non
hanno contenuto, e il download fallisce a ogni giro.

## Variabili

| chiave | dove si trova |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | Google Cloud Console, credenziali OAuth |
| `GOOGLE_OAUTH_CLIENT_SECRET` | idem |
| `GOOGLE_OAUTH_REDIRECT_URI` | URI di redirect autorizzato nel progetto |

Nell'autorizzazione servono `access_type=offline` **e** `prompt=consent`: senza
il secondo, alla seconda connessione Google non rimanda il refresh token e la
sincronizzazione muore dopo un'ora.
