"use strict";

// Building a provider the way the real service builds one.
//
// Two rules of the contract live here, and they are two of the three mistakes
// the contract exists to prevent:
//
//   * every call goes through `this.http`. It is also the only place where the
//     host applies timeouts and decides how errors behave;
//   * after every operation `takeRefreshedCredentials()` is called and whatever
//     it returns is persisted, **once**. A connector that renews its token and a
//     host that does not save it produce a connection that dies at the next
//     expiry, silently.

const axios = require("axios");
const { loadConnector } = require("./registry");
const state = require("./state");

// The same client as scripts/record.js: axios shaped the way the contract
// expects, with error statuses rejecting and carrying the response.
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

function build(dir) {
  const { manifest, Provider } = loadConnector(dir);
  const env = {};
  for (const entry of manifest.config || []) env[entry.key] = process.env[entry.key];

  const saved = state.connection(dir);
  const provider = new Provider({
    credentials: saved?.credentials || {},
    env,
    http,
    logger: { info() {}, warning() {}, error() {} },
  });

  return { provider, manifest };
}

// To be called after every operation. It is not a courtesy: it is the host's
// half of the bargain on credential renewal.
function persistRefresh(dir, provider) {
  const renewed = provider.takeRefreshedCredentials?.();
  if (!renewed) return false;
  const current = state.connection(dir)?.credentials || {};
  state.saveConnection(dir, { credentials: { ...current, ...renewed } });
  return true;
}

module.exports = { build, persistRefresh, http };
