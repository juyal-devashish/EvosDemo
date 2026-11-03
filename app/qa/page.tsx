"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { describeError, type ErrorContext } from "../errors";
import { LEVEL, shortHash } from "../labels";
import { useMounted } from "../useMounted";

// QA console. Every button calls a qa-only Convex mutation; the role check
// there is what protects it. Buttons that spend API budget say how much
// and need a second click to confirm (no browser dialogs).

const SCENARIOS = [
  "shortage",
  "impossible-deadline",
  "line-unavailable",
  "stale-inventory",
  "conflicting-priorities",
  "failed-write",
  "slow-machine",
  "reserved-stock",
];

export default function QaPage() {
  const mounted = useMounted();
  const me = useQuery(api.me.whoami, {});
  if (!mounted || me === undefined) return <p className="intro muted">Loading…</p>;
  if (me?.role !== "qa") {
    return (
      <section className="intro">
        <p className="eyebrow">QA</p>
        <h1 className="page-title">QA only</h1>
        <p className="lede">Sign in with a QA account to create sessions, authorize releases and run suites.</p>
      </section>
    );
  }
  return <Console />;
}

function useAction<A>(fn: (args: A) => Promise<unknown>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (args: A, ctx?: ErrorContext) => {
    setBusy(true);
    setError(null);
    try {
      await fn(args);
    } catch (e) {
      setError(describeError(e, ctx));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

/** A button that spends budget: first click arms it, second click runs it. */
function CostButton({ label, cost, onRun, disabled, testId }: { label: string; cost: string; onRun: () => void; disabled?: boolean; testId?: string }) {
  const [armed, setArmed] = useState(false);
  return armed ? (
    <span className="row">
      <button className="button-primary" onClick={() => { setArmed(false); onRun(); }} data-testid={testId && `${testId}-confirm`}>
        Confirm: {cost}
      </button>
      <button className="link-button" onClick={() => setArmed(false)}>
        Cancel
      </button>
    </span>
  ) : (
    <button className="button-secondary" onClick={() => setArmed(true)} disabled={disabled} data-testid={testId}>
      {label}
    </button>
  );
}

function Console() {
  const sessions = useQuery(api.sessions.listForReview, {});
  const createDemo = useAction(useMutation(api.sessions.createDemo));
  const [scenario, setScenario] = useState("slow-machine");
  const [selected, setSelected] = useState<Id<"sessions"> | null>(null);
  const sessionId = selected ?? sessions?.[0]?._id ?? null;

  return (
    <main>
      <section className="intro">
        <p className="eyebrow">QA · authorization and runs</p>
        <h1 className="page-title">QA console</h1>
        <p className="lede">Create demo sessions, authorize releases that passed the suite, request proposals and run suites.</p>
      </section>

      <section className="panel" aria-labelledby="new-session">
        <h2 id="new-session" className="panel-title" style={{ marginBottom: 12 }}>
          New demo session
        </h2>
        <div className="row">
          <label htmlFor="scenario" className="eyebrow">
            Seed from scenario
          </label>
          <select id="scenario" className="field" value={scenario} onChange={(e) => setScenario(e.target.value)}>
            {SCENARIOS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <button className="button-primary" disabled={createDemo.busy} onClick={() => createDemo.run({ scenarioId: scenario })}>
            {createDemo.busy ? "Creating…" : "Create session"}
          </button>
        </div>
        {createDemo.error && <p className="notice notice-error section" role="alert">{createDemo.error}</p>}
      </section>

      {sessions && sessions.length > 0 && (
        <section className="panel section" aria-labelledby="session-actions">
          <div className="row" style={{ marginBottom: 16 }}>
            <h2 id="session-actions" className="panel-title">
              Session
            </h2>
            <select className="field" value={sessionId ?? ""} onChange={(e) => setSelected(e.target.value as Id<"sessions">)} aria-label="Session">
              {sessions.map((s) => (
                <option key={s._id} value={s._id}>
                  {s.label} ({s.kind})
                </option>
              ))}
            </select>
          </div>
          {sessionId && <SessionActions sessionId={sessionId} />}
        </section>
      )}

      <SuiteRuns />
    </main>
  );
}

function SessionActions({ sessionId }: { sessionId: Id<"sessions"> }) {
  const data = useQuery(api.review.session, { sessionId });
  const promote = useAction(useMutation(api.permissions.promoteToSupervised));
  const request = useAction(useMutation(api.operator.request));
  const promoteLimited = useAction(useMutation(api.permissions.promoteToLimited));
  if (data === undefined) return <p className="muted">Loading…</p>;
  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Release</th>
              <th scope="col">Suite verdict</th>
              <th scope="col">Permission here</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.releases.map((r) => (
              <tr key={r.manifestHash}>
                <td>
                  <div>{r.operatorVersion}</div>
                  <div className="mono small muted">{shortHash(r.manifestHash)}</div>
                </td>
                <td className="mono small">{r.suiteVerdict}</td>
                <td data-testid={`qa-level-${r.operatorVersion}`}>{LEVEL[r.level] ?? r.level}</td>
                <td>
                  <div className="row">
                    {r.level === "shadow" && (
                      <button
                        className="button-primary"
                        disabled={promote.busy}
                        onClick={() => promote.run({ sessionId, manifestHash: r.manifestHash }, { operatorVersion: r.operatorVersion })}
                        data-testid={`promote-${r.operatorVersion}`}
                      >
                        Authorize supervised
                      </button>
                    )}
                    {(r.level === "supervised" || r.level === "demoted") && (
                      <RecoveryControl
                        sessionId={sessionId}
                        manifestHash={r.manifestHash}
                        busy={promoteLimited.busy}
                        onPromote={() => promoteLimited.run({ sessionId, manifestHash: r.manifestHash }, { operatorVersion: r.operatorVersion })}
                        testId={`limited-${r.operatorVersion}`}
                      />
                    )}
                    <CostButton
                      label="Request proposal"
                      cost="1 real API call, about $0.02"
                      disabled={request.busy}
                      onRun={() => request.run({ sessionId, manifestHash: r.manifestHash }, { operatorVersion: r.operatorVersion })}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted section">
        Authorizing needs a passed rs-1.0 verdict for that exact manifest; the backend refuses it otherwise.
      </p>
      {(promote.error || request.error || promoteLimited.error) && (
        <p className="notice notice-error section" role="alert">
          {promote.error ?? request.error ?? promoteLimited.error}
        </p>
      )}
    </>
  );
}

function SuiteRuns() {
  const runs = useQuery(api.suite.listRuns, {});
  const overview = useQuery(api.results.publicOverview, {});
  const start = useAction(useMutation(api.suite.start));
  const cancel = useAction(useMutation(api.suite.cancel));
  return (
    <section className="panel section" aria-labelledby="suite-runs">
      <h2 id="suite-runs" className="panel-title" style={{ marginBottom: 12 }}>
        Release suite runs
      </h2>
      <div className="row" style={{ marginBottom: 16 }}>
        {overview?.manifests.map((m) => (
          <CostButton
            key={m.manifestHash}
            label={`Run rs-1.0 on ${m.operatorVersion}`}
            cost="80 real API calls, about $1.85"
            disabled={start.busy}
            onRun={() => start.run({ manifestHash: m.manifestHash }, { operatorVersion: m.operatorVersion })}
          />
        ))}
      </div>
      {start.error && <p className="notice notice-error" role="alert">{start.error}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Started</th>
              <th scope="col">Manifest</th>
              <th scope="col">State</th>
              <th scope="col">Verdict</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {(runs ?? []).map((r) => (
              <tr key={r._id}>
                <td className="mono small">{new Date(r.startedAt).toLocaleString()}</td>
                <td className="mono small">{shortHash(r.manifestHash)}</td>
                <td>{r.state}</td>
                <td className="mono small">{r.verdict?.text ?? "running…"}</td>
                <td>
                  {r.state === "running" && (
                    <button className="link-button" disabled={cancel.busy} onClick={() => cancel.run({ suiteRunId: r._id })}>
                      Cancel
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Recovery evidence (SPEC §10.6) and the qa authorization to limited autonomy. */
function RecoveryControl({ sessionId, manifestHash, busy, onPromote, testId }: { sessionId: Id<"sessions">; manifestHash: string; busy: boolean; onPromote: () => void; testId: string }) {
  const ev = useQuery(api.permissions.recoveryStatus, { sessionId, manifestHash });
  if (ev === undefined) return null;
  return (
    <span className="row">
      <span className="mono small" data-testid={`${testId}-evidence`}>
        {ev.x}/{ev.n} fresh reviews · bound {ev.lowerBound.toFixed(3)} (need ≥ {ev.minFreshReviews} and ≥ {ev.floor})
      </span>
      <button className="button-secondary" onClick={onPromote} disabled={busy} data-testid={testId}>
        Authorize limited
      </button>
    </span>
  );
}
