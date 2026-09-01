"use strict";

// The connector's own suite, run by the host.
//
// It runs the real one — `conformance.test.js` — and not a second
// implementation of the checks: two definitions of "working" drift apart, and
// then the button and CI say different things.

const { execFile } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function runConformance(dir) {
  const file = path.join("connectors", dir, "conformance.test.js");
  return new Promise((resolve) => {
    const started = Date.now();
    execFile("node", ["--test", file], { cwd: ROOT, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const output = `${stdout}${stderr}`;
        const count = (label) => {
          const found = output.match(new RegExp(`^# ${label} (\\d+)$`, "m"));
          return found ? Number(found[1]) : 0;
        };
        const fail = count("fail");
        resolve({
          // The exit code is the authority: a count of zero can also mean the
          // suite never started.
          ok: !error && fail === 0,
          pass: count("pass"),
          fail,
          duration: Date.now() - started,
          output: output.trim(),
        });
      });
  });
}

module.exports = { runConformance };
