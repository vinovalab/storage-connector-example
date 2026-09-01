"use strict";

// Il registro dei connettori: si legge la cartella, non un elenco scritto a mano.
//
// E la regola che rende questo repository un modello e non un esempio. Nel
// servizio vero un connettore e **una cartella e basta**: `connectors/<nome>/`
// con il suo manifesto e la sua classe, e copiarla dentro e tutta
// l'installazione. Se questo ospite minimo tenesse un elenco da aggiornare, un
// collaboratore imparerebbe esattamente il gesto che il contratto esiste per
// eliminare.
//
// Le tre regole di rifiuto sono quelle del servizio vero:
//   * manifesto malformato — meglio all'avvio che in mano a un cliente;
//   * major di contratto diversa — un connettore scritto su regole vecchie
//     fallirebbe al primo delta, in silenzio;
//   * chiave doppia — due cartelle che dichiarano DROPBOX sono un errore di
//     copia, e vincerebbe l'ordine alfabetico, cioe il caso.
//
// Un connettore a cui manca la configurazione **non viene rifiutato**: viene
// caricato e marcato spento, con l'elenco di cio che gli manca. E la differenza
// fra un connettore che non compare e nessuno sa perche, e uno che compare
// spento dicendo quale variabile manca.

const fs = require("fs");
const path = require("path");
const { compatible, missingConfig, CONTRACT_VERSION } = require("@vinovalab/storage-connector-contract");

const CARTELLA = path.join(__dirname, "..", "connectors");

function leggiRegistro() {
  if (!fs.existsSync(CARTELLA)) return { connettori: [], rifiutati: [] };

  const connettori = [];
  const rifiutati = [];
  const chiaviViste = new Map();

  for (const voce of fs.readdirSync(CARTELLA, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!voce.isDirectory()) continue;
    const dir = voce.name;
    const base = path.join(CARTELLA, dir);
    const fileManifest = path.join(base, "manifest.js");
    const fileProvider = path.join(base, "provider.js");

    if (!fs.existsSync(fileManifest)) {
      rifiutati.push({ dir, motivo: "manca manifest.js" });
      continue;
    }
    if (!fs.existsSync(fileProvider)) {
      rifiutati.push({ dir, motivo: "manca provider.js" });
      continue;
    }

    let manifest;
    try {
      // Rilettura a ogni giro: un connettore in scrittura cambia sotto le mani,
      // e un manifesto in cache mostrerebbe la forma di ieri.
      delete require.cache[require.resolve(fileManifest)];
      manifest = require(fileManifest);
    } catch (errore) {
      rifiutati.push({ dir, motivo: `manifesto non valido: ${errore.message}` });
      continue;
    }

    if (!compatible(manifest)) {
      rifiutati.push({
        dir,
        motivo: `contratto ${manifest.contractVersion} incompatibile con ${CONTRACT_VERSION}`,
      });
      continue;
    }

    const gia = chiaviViste.get(manifest.key);
    if (gia) {
      rifiutati.push({ dir, motivo: `chiave ${manifest.key} gia dichiarata da ${gia}` });
      continue;
    }
    chiaviViste.set(manifest.key, dir);

    const mancanti = missingConfig(manifest, process.env);
    connettori.push({
      dir,
      key: manifest.key,
      label: manifest.label,
      description: manifest.description ?? null,
      contractVersion: manifest.contractVersion,
      authKind: manifest.auth?.kind ?? null,
      redirectPath: manifest.auth?.redirectPath ?? null,
      capabilities: manifest.capabilities ?? {},
      config: (manifest.config ?? []).map((c) => ({
        key: c.key, required: Boolean(c.required), secret: Boolean(c.secret),
        description: c.description ?? null,
      })),
      // Spento, non assente.
      abilitato: mancanti.length === 0,
      configMancante: mancanti,
      hasSuite: fs.existsSync(path.join(base, "conformance.test.js")),
      hasFixtures: fs.existsSync(path.join(base, "fixtures")),
    });
  }

  return { connettori, rifiutati };
}

// Il manifesto e la classe, per chi deve costruire un provider. Il registro
// legge il manifesto; solo qui si tocca il codice del connettore.
function caricaConnettore(dir) {
  const base = path.join(CARTELLA, dir);
  delete require.cache[require.resolve(path.join(base, "manifest.js"))];
  delete require.cache[require.resolve(path.join(base, "provider.js"))];
  return {
    manifest: require(path.join(base, "manifest.js")),
    Provider: require(path.join(base, "provider.js")),
    base,
  };
}

module.exports = { leggiRegistro, caricaConnettore, CARTELLA };
