import { useCallback, useEffect, useState } from "react";

// L'interfaccia dell'ospite. Il giro completo, nell'ordine in cui lo si fa:
//
//   Conformità → Autorizza → scegli cartella → Sync → cambia qualcosa → Sync
//
// L'ultimo passo è quello che nessuna fixture può verificare. La conformità
// controlla la forma di getChanges contro risposte registrate; che il
// connettore non riscarichi l'intero archivio a ogni giro si vede solo qui.

type Connettore = {
  dir: string; key: string; label: string; description: string | null;
  contractVersion: string; authKind: string | null; redirectPath: string | null;
  capabilities: Record<string, boolean>;
  config: Array<{ key: string; required: boolean; secret: boolean; description: string | null }>;
  abilitato: boolean; configMancante: string[];
  hasSuite: boolean; hasFixtures: boolean;
  connessione: {
    autorizzato: boolean; haRefresh: boolean;
    folderId: string | null; cursore: string | null; ultimaSync: string | null;
  };
};

type Conformita = { ok: boolean; pass: number; fail: number; durata: number; output: string };
type Passo = { nome: string; ok: boolean; dettaglio: string };
type Live = { ok: boolean; passi: Passo[]; durata: number };
type Cartella = { id: string; name?: string };
type Sync = {
  ok: boolean; modo: string; folderId: string;
  scaricati: Array<{ id: string; name: string | null; bytes: number }>;
  rimossi: Array<{ id: string }>;
  errori: Array<{ id: string; messaggio: string }>;
  trovati?: number; viste?: number;
  cursorePrecedente: string | null; cursore: string | null;
  credenzialiRinnovate: boolean; avvisi?: string[]; errore?: string; durata: number;
};

const json = async (url: string, init?: RequestInit) => {
  const r = await fetch(url, init);
  const p = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(p?.error || `HTTP ${r.status}`);
  return p.data;
};

export default function App() {
  const [connettori, setConnettori] = useState<Connettore[] | null>(null);
  const [rifiutati, setRifiutati] = useState<Array<{ dir: string; motivo: string }>>([]);
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState<string | null>(null);
  const [conformita, setConformita] = useState<Record<string, Conformita>>({});
  const [live, setLive] = useState<Record<string, Live>>({});
  const [cartelle, setCartelle] = useState<Record<string, Cartella[]>>({});
  const [sync, setSync] = useState<Record<string, Sync>>({});
  const [apertura, setApertura] = useState<Record<string, boolean>>({});

  const carica = useCallback(() => {
    fetch("/api/connectors")
      .then((r) => r.json())
      .then((p) => { setConnettori(p.data); setRifiutati(p.rifiutati || []); })
      .catch(() => setErrore("L'ospite non risponde. Avvialo con `npm start` nella radice del repository."));
  }, []);

  useEffect(() => { carica(); }, [carica]);

  const agisci = async (dir: string, azione: () => Promise<void>) => {
    setInCorso(dir); setErrore(null);
    try { await azione(); carica(); }
    catch (e) { setErrore(e instanceof Error ? e.message : String(e)); }
    finally { setInCorso(null); }
  };

  if (errore && !connettori) return <main><p className="errore">{errore}</p></main>;
  if (!connettori) return <main><p className="attesa">Caricamento…</p></main>;

  return (
    <main>
      <header>
        <span className="eyebrow">Storage connectors</span>
        <h1>Connection Test</h1>
        <p>
          Un ospite minimo: la versione più piccola di <code>storage-connector-service</code> che
          serva a provare un connettore per intero. Nessun database, nessuna autenticazione.
        </p>
      </header>

      {errore && <p className="errore">{errore}</p>}

      {rifiutati.length > 0 && (
        <div className="rifiutati">
          <strong>Connettori rifiutati dal registro</strong>
          <ul>{rifiutati.map((r) => <li key={r.dir}><code>{r.dir}</code> — {r.motivo}</li>)}</ul>
        </div>
      )}

      <div className="elenco">
        {connettori.map((c) => {
          const cn = c.connessione;
          const occupato = inCorso !== null;
          const esitoSync = sync[c.dir];
          return (
            <article key={c.dir} className="connettore">
              <div className="intestazione">
                <div>
                  <h2>{c.label}</h2>
                  <code className="chiave">{c.key}</code>
                  <span className="contratto">contract {c.contractVersion}</span>
                </div>
                {!c.abilitato && <span className="esito rosso">spento</span>}
              </div>

              {c.description && <p className="descrizione">{c.description}</p>}

              {!c.abilitato && (
                <p className="avviso">
                  Manca la configurazione: <code>{c.configMancante.join(", ")}</code>.
                  Vanno nel <code>.env</code> della radice — copia <code>.env.example</code>.
                </p>
              )}

              <ul className="capacita">
                {c.authKind && <li>{c.authKind}</li>}
                {Object.entries(c.capabilities).filter(([, v]) => v).map(([n]) => <li key={n}>{n}</li>)}
              </ul>

              {/* 1 — la conformità, sulle risposte registrate */}
              <section className="passo">
                <h3>1 · Conformità</h3>
                <p className="nota">
                  La suite del connettore sulle risposte registrate: nessun account, nessuna rete.
                  Dice se il connettore rispetta il contratto.
                </p>
                <button className="tastone" disabled={!c.hasSuite || occupato}
                  onClick={() => agisci(c.dir, async () => {
                    const esito = await json(`/api/connectors/${c.dir}/test`, { method: "POST" });
                    setConformita((p) => ({ ...p, [c.dir]: esito }));
                  })}>
                  {inCorso === c.dir ? "…" : "Esegui la conformità"}
                </button>
                {conformita[c.dir] && (
                  <div className="riepilogo">
                    <span className={conformita[c.dir].ok ? "verde" : "rosso"}>
                      {conformita[c.dir].ok ? "passata" : "fallita"}
                    </span>
                    <span>{conformita[c.dir].pass} passati</span>
                    {conformita[c.dir].fail > 0 && <span className="rosso">{conformita[c.dir].fail} falliti</span>}
                    <button className="collegamento" onClick={() => setApertura((a) => ({ ...a, [c.dir]: !a[c.dir] }))}>
                      {apertura[c.dir] ? "nascondi output" : "mostra output"}
                    </button>
                  </div>
                )}
                {conformita[c.dir] && apertura[c.dir] && <pre className="output">{conformita[c.dir].output}</pre>}
              </section>

              {/* 2 — l'autorizzazione */}
              <section className="passo">
                <h3>2 · Autorizzazione</h3>
                <p className="nota">
                  Apre il consenso del provider e riceve il ritorno su <code>{c.redirectPath}</code>,
                  che è il percorso dichiarato nel manifesto. Deve combaciare con quello registrato
                  nella console, o l'autorizzazione fallisce <em>dopo</em> il consenso.
                </p>
                <div className="reali">
                  <button className="tasto-secondario" disabled={!c.abilitato || occupato}
                    onClick={() => agisci(c.dir, async () => {
                      const d = await json(`/api/connectors/${c.dir}/auth-url`);
                      window.open(d.url, "_blank", "noopener");
                    })}>
                    {cn.autorizzato ? "Autorizza di nuovo" : "Autorizza"}
                  </button>
                  {cn.autorizzato && (
                    <button className="tasto-secondario" disabled={occupato}
                      onClick={() => agisci(c.dir, async () => {
                        await json(`/api/connectors/${c.dir}/connection`, { method: "DELETE" });
                        setSync((p) => ({ ...p, [c.dir]: undefined as any }));
                      })}>
                      Dimentica
                    </button>
                  )}
                  <span className="stato-cred">
                    {cn.autorizzato
                      ? (cn.haRefresh ? "autorizzato, con refresh token" : "autorizzato, senza refresh token — morirà alla scadenza")
                      : "non autorizzato"}
                  </span>
                </div>
              </section>

              {/* 3 — la connessione viva */}
              <section className="passo">
                <h3>3 · Connessione</h3>
                <p className="nota">
                  <code>testConnection</code> e poi <code>listFolders(null)</code>: due chiamate e non una,
                  perché la prima può passare con permessi troppo stretti per leggere qualcosa.
                </p>
                <button className="tasto-secondario" disabled={!cn.autorizzato || occupato}
                  onClick={() => agisci(c.dir, async () => {
                    const esito = await json(`/api/connectors/${c.dir}/live`, { method: "POST" });
                    setLive((p) => ({ ...p, [c.dir]: esito }));
                    const elenco = await json(`/api/connectors/${c.dir}/folders`);
                    setCartelle((p) => ({ ...p, [c.dir]: elenco }));
                  })}>
                  Prova la connessione
                </button>
                {live[c.dir] && (
                  <div className={`live ${live[c.dir].ok ? "verde" : "rosso"}`}>
                    <ul>
                      {live[c.dir].passi.map((p) => (
                        <li key={p.nome}><strong>{p.ok ? "✓" : "✗"} {p.nome}</strong><span>{p.dettaglio}</span></li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>

              {/* 4 — il giro completo */}
              <section className="passo">
                <h3>4 · Sincronizzazione</h3>
                <p className="nota">
                  Il primo giro scarica tutto e chiede il cursore di partenza. I successivi chiedono
                  solo il delta. <strong>Se il secondo giro riscarica tutto, il connettore è sbagliato</strong> —
                  ed è l'unica prova che le fixture non possono dare.
                </p>

                {cartelle[c.dir] && cartelle[c.dir].length > 0 && (
                  <label className="scelta">
                    Cartella da monitorare
                    <select defaultValue={cn.folderId ?? ""} disabled={occupato}
                      onChange={(e) => agisci(c.dir, async () => {
                        const esito = await json(`/api/connectors/${c.dir}/sync`, {
                          method: "POST", headers: { "content-type": "application/json" },
                          body: JSON.stringify({ folderId: e.target.value }),
                        });
                        setSync((p) => ({ ...p, [c.dir]: esito }));
                      })}>
                      <option value="" disabled>scegli…</option>
                      {cartelle[c.dir].map((f) => <option key={f.id} value={f.id}>{f.name || f.id}</option>)}
                    </select>
                  </label>
                )}

                <div className="reali">
                  <button className="tastone" disabled={!cn.autorizzato || !cn.folderId || occupato}
                    onClick={() => agisci(c.dir, async () => {
                      const esito = await json(`/api/connectors/${c.dir}/sync`, { method: "POST" });
                      setSync((p) => ({ ...p, [c.dir]: esito }));
                    })}>
                    {cn.cursore ? "Sincronizza (incrementale)" : "Sincronizza (primo giro)"}
                  </button>
                  {cn.cursore && (
                    <button className="tasto-secondario" disabled={occupato}
                      onClick={() => agisci(c.dir, async () => {
                        await json(`/api/connectors/${c.dir}/reset`, { method: "POST" });
                        setSync((p) => ({ ...p, [c.dir]: undefined as any }));
                      })}>
                      Ricomincia da capo
                    </button>
                  )}
                </div>

                {esitoSync && (
                  <div className={`live ${esitoSync.ok ? "verde" : "rosso"}`}>
                    <p>
                      <strong>giro {esitoSync.modo}</strong>
                      {esitoSync.trovati !== undefined && ` · ${esitoSync.trovati} file trovati`}
                      {esitoSync.viste !== undefined && ` · ${esitoSync.viste} modifiche viste`}
                      {` · ${esitoSync.scaricati.length} scaricati`}
                      {esitoSync.rimossi.length > 0 && ` · ${esitoSync.rimossi.length} rimossi`}
                      {esitoSync.credenzialiRinnovate && " · credenziali rinnovate e salvate"}
                    </p>
                    {esitoSync.errore && <p>{esitoSync.errore}</p>}
                    {esitoSync.avvisi?.map((a) => <p key={a} className="avviso">{a}</p>)}
                    {esitoSync.scaricati.length > 0 && (
                      <ul>{esitoSync.scaricati.slice(0, 12).map((f) => (
                        <li key={f.id}><strong>{f.name || f.id}</strong><span>{f.bytes} byte</span></li>
                      ))}</ul>
                    )}
                    <small>i file finiscono in <code>.sync/{c.dir}/</code></small>
                  </div>
                )}
              </section>
            </article>
          );
        })}
      </div>
    </main>
  );
}
