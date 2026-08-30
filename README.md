# storage-connector-example

Due connettori di storage completi — **Google Drive** e **Dropbox** — scritti
sul contratto `@vinovalab/storage-connector-contract`. Servono da modello a chi
ne scrive uno nuovo: Box, pCloud, Nextcloud, iCloud, un NAS.

Ogni connettore vive nel proprio repository. Quando è finito, la sua cartella
`connectors/<nome>/` si copia dentro `storage-connector-service/connectors/` e
**non si tocca nient'altro**: né elenchi di provider, né rotte OAuth, né
validazioni, né la UI. È tutto dichiarato nel manifesto.

## Come si scrive un connettore

1. Copia una delle due cartelle e rinominala. **Parti da `dropbox/`**: usa
   solo HTTP, gli identificatori sono percorsi e c'è il cursore per il delta —
   è la forma della maggior parte dei provider. `google-drive/` è il caso
   particolare (id opachi, documenti nativi da esportare).
2. Riscrivi `manifest.js`: chiave, etichetta, tipo di autenticazione, variabili
   d'ambiente richieste, capacità.
3. Riscrivi `provider.js`. Tutte le chiamate passano da `this.http` — è ciò che
   permette di verificarlo senza account e senza rete.
4. Prepara un account di prova come descrive `scenario.js` e registra le
   risposte: `npm run record -- <cartella>`.
5. `npm test`. Finché non è verde, non è finito.

```bash
npm install
npm test
```

## Cosa verifica la conformità

Non è una formalità: sono i modi in cui i connettori si rompono davvero.

| controllo | cosa impedisce |
|---|---|
| `listFiles` impagina fino alla fine | il connettore che legge solo la prima risposta: funziona con dieci file, ne perde tremila |
| `getChanges(null)` restituisce solo il cursore | il delta che rilegge tutto l'archivio a ogni giro, per sempre |
| il cursore avanza | la sincronizzazione che rivede gli stessi cambiamenti all'infinito |
| `downloadFile` → `{ buffer, mimeType }` | il Buffer nudo, che fa salvare un documento Google con l'estensione sbagliata |
| forma di file e cartelle | `modified` al posto di `modifiedAt`: date nulle scoperte settimane dopo |
| `takeRefreshedCredentials()` | il token rinnovato in memoria e mai salvato: la connessione muore al riavvio |
| `fileBelongsToFolder` sui provider a percorso | le sotto-cartelle che non sincronizzano mai niente |
| un 429 non diventa un elenco vuoto | l'host che legge «cartella svuotata» e cancella i documenti indicizzati |

## I due esempi, e perché sono diversi

**`connectors/dropbox/`** — OAuth2 con refresh, HTTP puro, identificatori che
sono percorsi in minuscolo, cursore di delta, `fileBelongsToFolder`
sovrascritto per il match ricorsivo. È il porting fedele del connettore in
produzione, con le chiamate spostate su `this.http`.

**`connectors/google-drive/`** — OAuth2 con `access_type=offline` e
`prompt=consent`, id opachi, cartelle che sono file con un mime speciale,
documenti nativi che si **esportano** invece di scaricarsi, cestino che va
letto come cancellazione, e un cursore finale (`newStartPageToken`) diverso
dall'ultimo `nextPageToken`.

Questo Drive **non usa `googleapis`**: le chiamate che servono sono sei, scritte
a mano stanno in duecento righe, non trascinano cento megabyte nell'immagine e
— soprattutto — passano da `this.http`, quindi si verificano offline. Un
connettore che parla con un SDK non è verificabile da chi non ha l'account.

> **Da sapere prima di sostituire quello in servizio:** questo Drive è
> verificato sulle fixture, non contro un account Google reale. Le risposte
> registrate riproducono le forme dell'API v3 così come le usa la versione in
> produzione, ma il primo giro su un account vero va fatto in DEV.

## Le fixture

Sono risposte del provider salvate su file. Chi le registra usa credenziali
vere; chi legge il codice, chi lo revisiona e la CI usano solo i file.

`createRecordingTransport` sostituisce con `***` i campi sensibili che conosce
— `authorization`, `access_token`, `refresh_token`, `client_secret`, password,
cookie. **Rileggile comunque**: finiscono in un repository pubblico, e un
provider può mettere un token dove nessuno se lo aspetta.

## Struttura

```
connectors/<nome>/
  manifest.js          identità, autenticazione, config richiesta, capacità
  provider.js          la classe che estende BaseProvider
  scenario.js          cosa contengono le fixture: file, cartelle, cambiamenti
  fixtures/*.json      le risposte registrate
  conformance.test.js  la conformità più i controlli specifici del provider
```

Questa cartella, e solo questa, è ciò che viene copiato nel servizio.
