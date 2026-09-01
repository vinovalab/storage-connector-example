"use strict";

// Costruire un provider come lo costruisce il servizio vero.
//
// Due regole del contratto vivono qui, e sono due dei tre errori per cui il
// contratto esiste:
//
//   * ogni chiamata passa da `this.http`. E anche il solo punto in cui l'ospite
//     applica timeout e comportamento sugli errori;
//   * dopo ogni operazione si chiama `takeRefreshedCredentials()` e si persiste
//     cio che restituisce, **una volta**. Un connettore che rinnova il token e
//     un ospite che non lo salva producono una connessione che muore alla
//     scadenza successiva, in silenzio.

const path = require("path");
const axios = require("axios");
const { caricaConnettore } = require("./registry");
const stato = require("./state");

// Lo stesso client di scripts/record.js: axios sagomato come il contratto si
// aspetta, con gli stati di errore che rifiutano portandosi dietro la risposta.
const http = async (config) => axios({ ...config, validateStatus: () => true, timeout: 30_000 })
  .then((r) => {
    if (r.status >= 400) {
      const err = new Error(`Request failed with status ${r.status}`);
      err.status = r.status;
      err.response = r;
      throw err;
    }
    return r;
  });

function costruisci(dir) {
  const { manifest, Provider } = caricaConnettore(dir);
  const env = {};
  for (const voce of manifest.config || []) env[voce.key] = process.env[voce.key];

  const salvata = stato.connessione(dir);
  const provider = new Provider({
    credentials: salvata?.credentials || {},
    env,
    http,
    logger: { info() {}, warning() {}, error() {} },
  });

  return { provider, manifest };
}

// Da chiamare dopo ogni operazione. Non e una cortesia: e la meta dell'ospite
// nel patto sul rinnovo delle credenziali.
function persistiRinnovo(dir, provider) {
  const nuove = provider.takeRefreshedCredentials?.();
  if (!nuove) return false;
  const corrente = stato.connessione(dir)?.credentials || {};
  stato.salvaConnessione(dir, { credentials: { ...corrente, ...nuove } });
  return true;
}

module.exports = { costruisci, persistiRinnovo, http };
