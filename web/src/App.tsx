import { useCallback, useEffect, useState } from "react";

// The host's interface. The full round, in the order you do it:
//
//   Conformance → Authorise → pick a folder → Sync → change something → Sync
//
// The last step is the one no fixture can verify. Conformance checks the shape
// of getChanges against recorded responses; that a connector does not
// re-download the whole archive every pass shows only here.

type Connector = {
  dir: string; key: string; label: string; description: string | null;
  contractVersion: string; authKind: string | null; redirectPath: string | null;
  capabilities: Record<string, boolean>;
  config: Array<{ key: string; required: boolean; secret: boolean; description: string | null }>;
  enabled: boolean; missingConfig: string[];
  hasSuite: boolean; hasFixtures: boolean;
  connection: {
    authorised: boolean; hasRefresh: boolean;
    folderId: string | null; cursor: string | null; lastSync: string | null;
  };
};

type Conformance = { ok: boolean; pass: number; fail: number; duration: number; output: string };
type Step = { name: string; ok: boolean; detail: string };
type Live = { ok: boolean; steps: Step[]; duration: number };
type Folder = { id: string; name?: string };
type Sync = {
  ok: boolean; mode: string; folderId: string;
  downloaded: Array<{ id: string; name: string | null; bytes: number }>;
  removed: Array<{ id: string }>;
  errors: Array<{ id: string; message: string }>;
  found?: number; seen?: number;
  previousCursor: string | null; cursor: string | null;
  credentialsRenewed: boolean; warnings?: string[]; error?: string; duration: number;
};

const json = async (url: string, init?: RequestInit) => {
  const r = await fetch(url, init);
  const p = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(p?.error || `HTTP ${r.status}`);
  return p.data;
};

export default function App() {
  const [connectors, setConnectors] = useState<Connector[] | null>(null);
  const [rejected, setRejected] = useState<Array<{ dir: string; reason: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [conformance, setConformance] = useState<Record<string, Conformance>>({});
  const [live, setLive] = useState<Record<string, Live>>({});
  const [folders, setFolders] = useState<Record<string, Folder[]>>({});
  const [sync, setSync] = useState<Record<string, Sync>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const load = useCallback(() => {
    fetch("/api/connectors")
      .then((r) => r.json())
      .then((p) => { setConnectors(p.data); setRejected(p.rejected || []); })
      .catch(() => setError("The host is not answering. Start it with `npm start` in the repository root."));
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (dir: string, action: () => Promise<void>) => {
    setBusy(dir); setError(null);
    try { await action(); load(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  if (error && !connectors) return <main><p className="error-box">{error}</p></main>;
  if (!connectors) return <main><p className="loading">Loading…</p></main>;

  return (
    <main>
      <header>
        <span className="eyebrow">Storage connectors</span>
        <h1>Connection Test</h1>
        <p>
          A minimal host: the smallest version of <code>storage-connector-service</code> that is
          enough to run a connector end to end. No database, no authentication.
        </p>
      </header>

      {error && <p className="error-box">{error}</p>}

      {rejected.length > 0 && (
        <div className="rejected">
          <strong>Connectors the registry rejected</strong>
          <ul>{rejected.map((r) => <li key={r.dir}><code>{r.dir}</code> — {r.reason}</li>)}</ul>
        </div>
      )}

      <div className="list">
        {connectors.map((c) => {
          const cn = c.connection;
          const working = busy !== null;
          const syncResult = sync[c.dir];
          return (
            <article key={c.dir} className="connector">
              <div className="heading">
                <div>
                  <h2>{c.label}</h2>
                  <code className="key">{c.key}</code>
                  <span className="contract">contract {c.contractVersion}</span>
                </div>
                {!c.enabled && <span className="verdict red">off</span>}
              </div>

              {c.description && <p className="description">{c.description}</p>}

              {!c.enabled && (
                <p className="warning">
                  Configuration missing: <code>{c.missingConfig.join(", ")}</code>.
                  They go in the root <code>.env</code> — copy <code>.env.example</code>.
                </p>
              )}

              <ul className="capabilities">
                {c.authKind && <li>{c.authKind}</li>}
                {Object.entries(c.capabilities).filter(([, v]) => v).map(([n]) => <li key={n}>{n}</li>)}
              </ul>

              {/* 1 — conformance, against recorded responses */}
              <section className="step">
                <h3>1 · Conformance</h3>
                <p className="note">
                  The connector's own suite against its recorded responses: no account, no network.
                  It says whether the connector honours the contract.
                </p>
                <button className="primary-button" disabled={!c.hasSuite || working}
                  onClick={() => act(c.dir, async () => {
                    const result = await json(`/api/connectors/${c.dir}/test`, { method: "POST" });
                    setConformance((p) => ({ ...p, [c.dir]: result }));
                  })}>
                  {busy === c.dir ? "…" : "Run conformance"}
                </button>
                {conformance[c.dir] && (
                  <div className="summary">
                    <span className={conformance[c.dir].ok ? "verde" : "rosso"}>
                      {conformance[c.dir].ok ? "passed" : "failed"}
                    </span>
                    <span>{conformance[c.dir].pass} passed</span>
                    {conformance[c.dir].fail > 0 && <span className="red">{conformance[c.dir].fail} failed</span>}
                    <button className="link-button" onClick={() => setOpen((a) => ({ ...a, [c.dir]: !a[c.dir] }))}>
                      {open[c.dir] ? "hide output" : "show output"}
                    </button>
                  </div>
                )}
                {conformance[c.dir] && open[c.dir] && <pre className="output">{conformance[c.dir].output}</pre>}
              </section>

              {/* 2 — the authorisation */}
              <section className="step">
                <h3>2 · Authorisation</h3>
                <p className="note">
                  Opens the provider's consent page and takes the callback on <code>{c.redirectPath}</code>,
                  the path declared in the manifest. It must match the one registered in the console, or
                  the authorisation fails <em>after</em> consent.
                </p>
                <div className="actions">
                  <button className="secondary-button" disabled={!c.enabled || working}
                    onClick={() => act(c.dir, async () => {
                      const d = await json(`/api/connectors/${c.dir}/auth-url`);
                      window.open(d.url, "_blank", "noopener");
                    })}>
                    {cn.authorised ? "Authorise again" : "Authorise"}
                  </button>
                  {cn.authorised && (
                    <button className="secondary-button" disabled={working}
                      onClick={() => act(c.dir, async () => {
                        await json(`/api/connectors/${c.dir}/connection`, { method: "DELETE" });
                        setSync((p) => ({ ...p, [c.dir]: undefined as any }));
                      })}>
                      Forget
                    </button>
                  )}
                  <span className="credential-state">
                    {cn.authorised
                      ? (cn.hasRefresh ? "authorised, with refresh token" : "authorised, no refresh token — it will die at expiry")
                      : "not authorised"}
                  </span>
                </div>
              </section>

              {/* 3 — the live connection */}
              <section className="step">
                <h3>3 · Connection</h3>
                <p className="note">
                  <code>testConnection</code> and then <code>listFolders(null)</code>: two calls and not one,
                  because the first can pass with permissions too narrow to read anything.
                </p>
                <button className="secondary-button" disabled={!cn.authorised || working}
                  onClick={() => act(c.dir, async () => {
                    const result = await json(`/api/connectors/${c.dir}/live`, { method: "POST" });
                    setLive((p) => ({ ...p, [c.dir]: result }));
                    const list = await json(`/api/connectors/${c.dir}/folders`);
                    setFolders((p) => ({ ...p, [c.dir]: list }));
                  })}>
                  Test the connection
                </button>
                {live[c.dir] && (
                  <div className={`live ${live[c.dir].ok ? "green" : "red"}`}>
                    <ul>
                      {live[c.dir].steps.map((s) => (
                        <li key={s.name}><strong>{s.ok ? "✓" : "✗"} {s.name}</strong><span>{s.detail}</span></li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>

              {/* 4 — the full round */}
              <section className="step">
                <h3>4 · Synchronisation</h3>
                <p className="note">
                  The first pass downloads everything and asks for the starting cursor. The ones after
                  ask for the delta. <strong>If the second pass downloads everything again, the connector
                  is wrong</strong> — and that is the one proof fixtures cannot give.
                </p>

                {folders[c.dir] && folders[c.dir].length > 0 && (
                  <label className="choice">
                    Folder to monitor
                    <select defaultValue={cn.folderId ?? ""} disabled={working}
                      onChange={(e) => act(c.dir, async () => {
                        const result = await json(`/api/connectors/${c.dir}/sync`, {
                          method: "POST", headers: { "content-type": "application/json" },
                          body: JSON.stringify({ folderId: e.target.value }),
                        });
                        setSync((p) => ({ ...p, [c.dir]: result }));
                      })}>
                      <option value="" disabled>choose…</option>
                      {folders[c.dir].map((f) => <option key={f.id} value={f.id}>{f.name || f.id}</option>)}
                    </select>
                  </label>
                )}

                <div className="actions">
                  <button className="primary-button" disabled={!cn.authorised || !cn.folderId || working}
                    onClick={() => act(c.dir, async () => {
                      const result = await json(`/api/connectors/${c.dir}/sync`, { method: "POST" });
                      setSync((p) => ({ ...p, [c.dir]: result }));
                    })}>
                    {cn.cursor ? "Synchronise (incremental)" : "Synchronise (first pass)"}
                  </button>
                  {cn.cursor && (
                    <button className="secondary-button" disabled={working}
                      onClick={() => act(c.dir, async () => {
                        await json(`/api/connectors/${c.dir}/reset`, { method: "POST" });
                        setSync((p) => ({ ...p, [c.dir]: undefined as any }));
                      })}>
                      Start over
                    </button>
                  )}
                </div>

                {syncResult && (
                  <div className={`live ${syncResult.ok ? "green" : "red"}`}>
                    <p>
                      <strong>{syncResult.mode} pass</strong>
                      {syncResult.found !== undefined && ` · ${syncResult.found} files found`}
                      {syncResult.seen !== undefined && ` · ${syncResult.seen} changes seen`}
                      {` · ${syncResult.downloaded.length} downloaded`}
                      {syncResult.removed.length > 0 && ` · ${syncResult.removed.length} removed`}
                      {syncResult.credentialsRenewed && " · credentials renewed and saved"}
                    </p>
                    {syncResult.error && <p>{syncResult.error}</p>}
                    {syncResult.warnings?.map((w) => <p key={w} className="warning">{w}</p>)}
                    {syncResult.downloaded.length > 0 && (
                      <ul>{syncResult.downloaded.slice(0, 12).map((f) => (
                        <li key={f.id}><strong>{f.name || f.id}</strong><span>{f.bytes} bytes</span></li>
                      ))}</ul>
                    )}
                    <small>files land in <code>.sync/{c.dir}/</code></small>
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
