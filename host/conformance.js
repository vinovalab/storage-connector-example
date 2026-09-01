"use strict";

// La suite del connettore, eseguita dall'ospite.
//
// Si lancia quella vera — `conformance.test.js` — e non una seconda
// implementazione dei controlli: due definizioni di "funziona" divergono, e
// allora il pulsante e la CI direbbero cose diverse.

const { execFile } = require("child_process");
const path = require("path");

const RADICE = path.join(__dirname, "..");

function eseguiConformita(dir) {
  const file = path.join("connectors", dir, "conformance.test.js");
  return new Promise((resolve) => {
    const inizio = Date.now();
    execFile("node", ["--test", file], { cwd: RADICE, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
      (errore, stdout, stderr) => {
        const output = `${stdout}${stderr}`;
        const numero = (etichetta) => {
          const trovato = output.match(new RegExp(`^# ${etichetta} (\\d+)$`, "m"));
          return trovato ? Number(trovato[1]) : 0;
        };
        const fail = numero("fail");
        resolve({
          // Il codice di uscita e l'autorita: un conteggio a zero puo anche
          // voler dire che la suite non e partita affatto.
          ok: !errore && fail === 0,
          pass: numero("pass"),
          fail,
          durata: Date.now() - inizio,
          output: output.trim(),
        });
      });
  });
}

module.exports = { eseguiConformita };
