import { useEffect, useState } from "react";

// One page, one button per connector. No login, and none is needed: every call
// a connector makes goes through `this.http`, and the responses are recorded in
// its fixtures. The test runs with no account and no network — which is the
// whole point of the contract.

type Connettore = {
  dir: string;
  key: string;
  label: string;
  description: string | null;
  contractVersion: string | null;
  authKind: string | null;
  capabilities: Record<string, boolean>;
  config: Array<{ key: string; required: boolean; secret: boolean; description: string | null }>;
  hasSuite: boolean;
  hasFixtures: boolean;
  error?: string;
};

type Esito = { ok: boolean; pass: number; fail: number; durata: number; output: string };

export default function App() {
  const [connettori, setConnettori] = useState<Connettore[] | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState<string | null>(null);
  const [esiti, setEsiti] = useState<Record<string, Esito>>({});
  const [apertura, setApertura] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch("/api/connectors")
      .then((r) => r.json())
      .then((p) => setConnettori(p.data))
      .catch((e) => setErrore(e instanceof Error ? e.message : "Cannot read the connectors."));
  }, []);

  async function prova(c: Connettore) {
    setInCorso(c.dir);
    try {
      const risposta = await fetch(`/api/connectors/${encodeURIComponent(c.dir)}/test`, { method: "POST" });
      const payload = await risposta.json();
      if (!risposta.ok) throw new Error(payload?.error || "The test could not be started.");
      setEsiti((precedenti) => ({ ...precedenti, [c.dir]: payload.data }));
      // A failure is the reason you pressed the button: it opens by itself.
      if (!payload.data.ok) setApertura((a) => ({ ...a, [c.dir]: true }));
    } catch (e) {
      setErrore(e instanceof Error ? e.message : "The test could not be started.");
    } finally {
      setInCorso(null);
    }
  }

  return (
    <main>
      <header>
        <span className="eyebrow">Storage connectors</span>
        <h1>Connection Test</h1>
        <p>
          Each button runs that connector's conformance suite — the same one <code>npm test</code> runs —
          against its recorded responses. No account, no credentials, no network.
        </p>
      </header>

      {errore && <p className="errore">{errore}</p>}

      {!connettori ? <p className="attesa">Loading…</p>
        : connettori.length === 0 ? (
          <div className="vuoto">
            <h2>No connectors found</h2>
            <p>Add a directory under <code>connectors/</code> with a <code>manifest.js</code>.</p>
          </div>
        ) : (
          <div className="elenco">
            {connettori.map((c) => {
              const esito = esiti[c.dir];
              const provabile = c.hasSuite && !c.error;
              return (
                <article key={c.dir} className="connettore">
                  <div className="intestazione">
                    <div>
                      <h2>{c.label}</h2>
                      <code className="chiave">{c.key}</code>
                      {c.contractVersion && <span className="contratto">contract {c.contractVersion}</span>}
                    </div>
                    {esito && (
                      <span className={`esito ${esito.ok ? "verde" : "rosso"}`}>
                        {esito.ok ? "Passed" : "Failed"}
                      </span>
                    )}
                  </div>

                  {c.description && <p className="descrizione">{c.description}</p>}

                  <ul className="capacita">
                    {c.authKind && <li>{c.authKind}</li>}
                    {Object.entries(c.capabilities)
                      .filter(([, attiva]) => attiva)
                      .map(([nome]) => <li key={nome}>{nome}</li>)}
                  </ul>

                  {c.error && <p className="errore">manifest.js does not load: {c.error}</p>}
                  {!c.error && !c.hasSuite && <p className="avviso">No <code>conformance.test.js</code> in this directory.</p>}
                  {!c.error && c.hasSuite && !c.hasFixtures && (
                    <p className="avviso">
                      No <code>fixtures/</code>: record them with <code>npm run record -- {c.dir}</code>.
                    </p>
                  )}

                  <button className="tastone" disabled={!provabile || inCorso !== null} onClick={() => prova(c)}>
                    {inCorso === c.dir ? "Running…" : "Test connection"}
                  </button>

                  {esito && (
                    <div className="riepilogo">
                      <span>{esito.pass} passed</span>
                      {esito.fail > 0 && <span className="rosso">{esito.fail} failed</span>}
                      <span>{(esito.durata / 1000).toFixed(1)}s</span>
                      <button className="collegamento"
                        onClick={() => setApertura((a) => ({ ...a, [c.dir]: !a[c.dir] }))}>
                        {apertura[c.dir] ? "Hide output" : "Show output"}
                      </button>
                    </div>
                  )}

                  {esito && apertura[c.dir] && <pre className="output">{esito.output}</pre>}
                </article>
              );
            })}
          </div>
        )}
    </main>
  );
}
