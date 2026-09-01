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

type Passo = { nome: string; ok: boolean; dettaglio: string };
type EsitoLive = {
  ok: boolean; passi: Passo[]; durata: number;
  origineCredenziali: string; errore?: string;
};
type StatoCredenziali = { autorizzato: boolean; scadenza: string | null; haRefresh: boolean };

export default function App() {
  const [connettori, setConnettori] = useState<Connettore[] | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState<string | null>(null);
  const [esiti, setEsiti] = useState<Record<string, Esito>>({});
  const [apertura, setApertura] = useState<Record<string, boolean>>({});
  const [live, setLive] = useState<Record<string, EsitoLive>>({});
  const [cred, setCred] = useState<Record<string, StatoCredenziali>>({});

  useEffect(() => {
    fetch("/api/connectors")
      .then((r) => r.json())
      .then((p) => {
        setConnettori(p.data);
        // Le credenziali stanno in memoria del dev server: dopo un riavvio non
        // ci sono piu, e la pagina deve dirlo invece di mostrare un pulsante
        // che fallira.
        for (const c of p.data as Connettore[]) void aggiornaCredenziali(c.dir);
      })
      .catch((e) => setErrore(e instanceof Error ? e.message : "Cannot read the connectors."));
  }, []);

  async function aggiornaCredenziali(dir: string) {
    try {
      const r = await fetch(`/api/connectors/${encodeURIComponent(dir)}/credentials`);
      const p = await r.json();
      setCred((precedenti) => ({ ...precedenti, [dir]: p.data }));
    } catch { /* lo stato resta ignoto: i pulsanti restano disponibili */ }
  }

  async function autorizza(c: Connettore) {
    setErrore(null);
    try {
      const r = await fetch(`/api/connectors/${encodeURIComponent(c.dir)}/auth-url`);
      const p = await r.json();
      if (!r.ok) throw new Error(p?.error || "Cannot build the authorisation URL.");
      // Nuova scheda: al ritorno il dev server scrive la pagina di esito, e
      // questa resta dov'era.
      window.open(p.data.url, "_blank", "noopener");
    } catch (e) {
      setErrore(e instanceof Error ? e.message : "Cannot start the authorisation.");
    }
  }

  async function provaLive(c: Connettore) {
    setInCorso(c.dir);
    try {
      const r = await fetch(`/api/connectors/${encodeURIComponent(c.dir)}/live`, { method: "POST" });
      const p = await r.json();
      if (!r.ok) throw new Error(p?.error || "The live test could not be started.");
      setLive((precedenti) => ({ ...precedenti, [c.dir]: p.data }));
      void aggiornaCredenziali(c.dir);
    } catch (e) {
      setErrore(e instanceof Error ? e.message : "The live test could not be started.");
    } finally {
      setInCorso(null);
    }
  }

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
          Two different questions, two different buttons.
        </p>
        <ul className="legenda">
          <li>
            <strong>Conformance</strong> runs the connector's own suite — the one <code>npm test</code> runs —
            against its <em>recorded</em> responses. No account, no credentials, no network: the replay
            transport cannot reach one.
          </li>
          <li>
            <strong>Live connection</strong> talks to the provider for real, with the variables in
            <code>.env</code> and the credentials from the authorisation. It answers what fixtures never can:
            whether these credentials still work.
          </li>
        </ul>
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
                    {inCorso === c.dir ? "Running…" : "Conformance — recorded"}
                  </button>

                  <div className="reali">
                    <button className="tasto-secondario" disabled={inCorso !== null} onClick={() => autorizza(c)}>
                      {cred[c.dir]?.autorizzato ? "Authorise again" : "Authorise"}
                    </button>
                    <button className="tasto-secondario" disabled={inCorso !== null} onClick={() => provaLive(c)}>
                      Live connection
                    </button>
                    {cred[c.dir] && (
                      <span className="stato-cred">
                        {cred[c.dir].autorizzato
                          ? (cred[c.dir].haRefresh
                              ? "authorised, with refresh token"
                              : "authorised, no refresh token — it will die at expiry")
                          : "not authorised in this session"}
                      </span>
                    )}
                  </div>

                  {live[c.dir] && (
                    <div className={`live ${live[c.dir].ok ? "verde" : "rosso"}`}>
                      {live[c.dir].errore
                        ? <p>{live[c.dir].errore}</p>
                        : (
                          <ul>
                            {live[c.dir].passi.map((passo) => (
                              <li key={passo.nome}>
                                <strong>{passo.ok ? "✓" : "✗"} {passo.nome}</strong>
                                <span>{passo.dettaglio}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      <small>
                        credentials from: {live[c.dir].origineCredenziali} · {(live[c.dir].durata / 1000).toFixed(1)}s
                      </small>
                    </div>
                  )}

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
