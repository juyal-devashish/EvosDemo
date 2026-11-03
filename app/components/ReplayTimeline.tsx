"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { LEVEL, shortHash } from "../labels";

// Act 2 on the public results page: the recorded fault-injection replay.
// Every number comes from the replay's stored records.

export function ReplayTimeline() {
  const data = useQuery(api.evidence.replayTimeline, {});
  if (data === undefined) return <p className="muted section">Loading replay…</p>;
  if (data === null) {
    return (
      <section className="section placeholder" aria-labelledby="act2">
        <p className="eyebrow">Act 2 · Fault-injection replay</p>
        <h2 id="act2" className="panel-title" style={{ margin: "6px 0" }}>
          Not recorded yet
        </h2>
      </section>
    );
  }
  const version = (h: string) => data.manifests.find((m) => m.manifestHash === h)?.operatorVersion ?? shortHash(h);
  const maxReviews = Math.max(1, ...data.days.map((d) => d.reviews));

  return (
    <section className="section panel" aria-labelledby="act2" data-testid="replay">
      <p className="notice notice-warn" role="note" style={{ marginBottom: 16 }}>
        <strong>Fault injection.</strong> op-v1 failed the release gate. Here it is deliberately given limited autonomy to
        ask: what if a defect like this slipped past the gate?
      </p>
      <div className="panel-head">
        <div>
          <p className="eyebrow">Act 2 · Fault-injection replay · real AI proposals</p>
          <h2 id="act2" className="panel-title">
            Demotion, then refusal
          </h2>
          <p className="small muted">
            {data.session.slotsPerDay} decisions per simulated day · SMT-2 runs 30% slow from day 4 · {data.executedCount} actions executed
          </p>
        </div>
        <span className="badge badge-neutral">Synthetic reviewer</span>
      </div>

      <p className="eyebrow">Review agreement per day (synthetic reviewer: rule checks + duration)</p>
      <div className="day-bars" role="table" aria-label="Reviews per day">
        {data.days.map((d) => (
          <div key={d.day} className="day-bar" role="row" data-testid={`day-${d.day}`}>
            <span className="mono small" role="cell">
              day {d.day}
            </span>
            <span className="bar" role="cell" aria-label={`${d.agreed} agreed, ${d.edited} edited`}>
              <span className="bar-agree" style={{ width: `${(d.agreed / maxReviews) * 100}%` }} />
              <span className="bar-edit" style={{ width: `${(d.edited / maxReviews) * 100}%` }} />
            </span>
            <span className="mono small" role="cell">
              {d.agreed}/{d.reviews} agreed · {d.manifestHashes.map(version).join(", ")}
            </span>
          </div>
        ))}
      </div>
      <p className="small muted">
        Blue: agreed. Red: the reviewer edited the plan. Recovery-phase reviews are supervised (before execution).
      </p>

      <div className="table-wrap section">
        <table>
          <thead>
            <tr>
              <th scope="col">Monitor window</th>
              <th scope="col">Release</th>
              <th scope="col" className="num">
                Agreed
              </th>
              <th scope="col" className="num">
                Pending
              </th>
              <th scope="col" className="num">
                P(X ≤ x | p₀)
              </th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {data.windows.map((w) => (
              <tr key={w.id} data-testid={`window-${w.windowIndex}`}>
                <td className="mono small">
                  days {w.startDay}–{w.endDay} (evaluated day {w.evaluatedOnDay})
                </td>
                <td>{version(w.manifestHash)}</td>
                <td className="num">
                  {w.x}/{w.n}
                </td>
                <td className="num">{w.pending}</td>
                <td className="num">{w.pValue === null ? "—" : w.pValue.toExponential(2)}</td>
                <td>
                  <span className={`badge ${w.status === "signal" ? "badge-fail" : w.status === "ok" ? "badge-pass" : "badge-warn"}`}>
                    {w.status === "signal" ? "Signal" : w.status === "ok" ? "OK" : "Insufficient data"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        Signal if P(X ≤ x | n, p₀) ≤ α = {data.windows[0]?.alpha ?? 0.00135}, with p₀ = {data.windows[0]?.p0 ?? "—"} frozen
        before this session. p₀ is largely set by the reviewer model&apos;s pPicky, an assumption.
      </p>

      <p className="eyebrow section">Permission changes</p>
      <ol className="plain-list">
        {data.permissionChanges.map((c) => (
          <li key={c.id} className="small">
            <span className="mono">{version(c.manifestHash)}</span>: {LEVEL[c.from] ?? c.from} → <strong>{LEVEL[c.to] ?? c.to}</strong>{" "}
            <span className="muted">({c.trigger.replaceAll("_", " ")})</span>
            {c.note && <div className="muted">{c.note}</div>}
          </li>
        ))}
      </ol>

      {data.refusedActionIds.length > 0 && (
        <div className="section row">
          <span className="badge badge-fail">Refused by the backend</span>
          {data.refusedActionIds.map((id) => (
            <Link key={id} href={`/evidence/${id}`} className="link-button" data-testid="evidence-link">
              View evidence
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
