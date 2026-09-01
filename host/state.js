"use strict";

// The host's state: connections, chosen folder, cursor.
//
// A JSON file and not a database. The real service uses Postgres, but the point
// here is that a collaborator runs `npm start` and nothing else: asking them to
// stand up a database to try their own connector means they will not try it.
//
// The file holds **live tokens**, so it is git-ignored. The difference between
// this and the real service is not the shape of the data but where it lands, and
// it is written here so nobody discovers it by copying this file into
// production.

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", ".host-state.json");

function read() {
  if (!fs.existsSync(FILE)) return { connections: {} };
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    // A corrupt file must not stop the host from starting: it starts over and
    // the authorisation is done again, which is a nuisance, not a failure.
    return { connections: {} };
  }
}

function write(state) {
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
}

function connection(dir) {
  return read().connections[dir] || null;
}

function saveConnection(dir, patch) {
  const state = read();
  state.connections[dir] = { ...(state.connections[dir] || {}), ...patch };
  write(state);
  return state.connections[dir];
}

function forgetConnection(dir) {
  const state = read();
  delete state.connections[dir];
  write(state);
}

module.exports = { read, connection, saveConnection, forgetConnection, FILE };
