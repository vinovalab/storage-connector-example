"use strict";

// Lo stato dell'ospite: connessioni, cartella scelta, cursore.
//
// Un file JSON e non un database. Il servizio vero usa Postgres, ma qui
// l'obiettivo e che un collaboratore faccia `npm start` e basta: chiedergli di
// far salire un database per provare il proprio connettore significa che non lo
// provera.
//
// Il file contiene **token vivi**, quindi e ignorato da git. La differenza fra
// questo e il servizio vero non e la forma dei dati ma dove finiscono, ed e
// scritto qui perche nessuno lo scopra copiando questo file in produzione.

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", ".host-state.json");

function leggi() {
  if (!fs.existsSync(FILE)) return { connessioni: {} };
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    // Un file corrotto non deve impedire di ripartire: si riparte da zero e si
    // rifa l'autorizzazione, che e un fastidio, non un guasto.
    return { connessioni: {} };
  }
}

function scrivi(stato) {
  fs.writeFileSync(FILE, JSON.stringify(stato, null, 2) + "\n", { mode: 0o600 });
}

function connessione(dir) {
  return leggi().connessioni[dir] || null;
}

function salvaConnessione(dir, patch) {
  const stato = leggi();
  stato.connessioni[dir] = { ...(stato.connessioni[dir] || {}), ...patch };
  scrivi(stato);
  return stato.connessioni[dir];
}

function dimenticaConnessione(dir) {
  const stato = leggi();
  delete stato.connessioni[dir];
  scrivi(stato);
}

module.exports = { leggi, connessione, salvaConnessione, dimenticaConnessione, FILE };
