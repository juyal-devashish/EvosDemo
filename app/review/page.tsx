"use client";

import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ProposalCard } from "../components/ProposalCard";
import { LEVEL } from "../labels";
import { useMounted } from "../useMounted";

// Review panel (planner, qa). Data and actions are role-checked in Convex;
// this page only decides what to show.

export default function ReviewPage() {
  const mounted = useMounted();
  const me = useQuery(api.me.whoami, {});
  if (!mounted || me === undefined) return <p className="intro muted">Loading…</p>;
  if (me === null || me.role === null) {
    return (
      <section className="intro">
        <p className="eyebrow">Review</p>
        <h1 className="page-title">Sign in to review</h1>
        <p className="lede">The review panel is for planners and QA. Sign in with an account that has one of those roles.</p>
      </section>
    );
  }
  return <Review canApprove />;
}

function Review({ canApprove }: { canApprove: boolean }) {
  const sessions = useQuery(api.sessions.listForReview, {});
  const [selected, setSelected] = useState<Id<"sessions"> | null>(null);
  const sessionId = selected ?? sessions?.[0]?._id ?? null;

  return (
    <main>
      <section className="intro">
        <p className="eyebrow">Review · supervised decisions</p>
        <h1 className="page-title">Review panel</h1>
        <p className="lede">
          Check each proposal against its guardrails, then approve it or leave it. An approval binds to this exact revision
          and factory state.
        </p>
      </section>

      {sessions === undefined ? (
        <p className="muted">Loading sessions…</p>
      ) : sessions.length === 0 ? (
        <div className="placeholder">No demo session yet. QA can create one on the QA page.</div>
      ) : (
        <>
          <div className="row" style={{ marginBottom: 24 }}>
            <label htmlFor="session" className="eyebrow">
              Session
            </label>
            <select
              id="session"
              className="field"
              value={sessionId ?? ""}
              onChange={(e) => setSelected(e.target.value as Id<"sessions">)}
            >
              {sessions.map((s) => (
                <option key={s._id} value={s._id}>
                  {s.label} ({s.kind})
                </option>
              ))}
            </select>
          </div>
          {sessionId && <SessionView sessionId={sessionId} canApprove={canApprove} />}
        </>
      )}
    </main>
  );
}

function SessionView({ sessionId, canApprove }: { sessionId: Id<"sessions">; canApprove: boolean }) {
  const data = useQuery(api.review.session, { sessionId });
  if (data === undefined) return <p className="muted">Loading session…</p>;

  return (
    <>
      {data.session.faultInjection && (
        <p className="notice notice-warn" role="note" style={{ marginBottom: 16 }}>
          Fault-injection session: permissions here may be deliberately overridden for testing.
        </p>
      )}
      <div className="metrics">
        <div className="metric">
          <div className="eyebrow">Shift</div>
          <div className="metric-value">{data.session.currentShift}</div>
        </div>
        <div className="metric">
          <div className="eyebrow">State version</div>
          <div className="metric-value">{data.session.stateVersion}</div>
        </div>
        {data.releases.map((r) => (
          <div className="metric" key={r.manifestHash}>
            <div className="eyebrow">{r.operatorVersion} permission</div>
            <div className="metric-value" data-testid={`level-${r.operatorVersion}`}>
              {LEVEL[r.level] ?? r.level}
            </div>
          </div>
        ))}
      </div>

      <div className="workspace">
        <section className="panel" aria-labelledby="schedule">
          <p className="eyebrow">Factory</p>
          <h2 id="schedule" className="panel-title" style={{ marginBottom: 12 }}>
            Current schedule
          </h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Line</th>
                  <th scope="col">Order</th>
                  <th scope="col" className="num">
                    Start
                  </th>
                  <th scope="col" className="num">
                    Finish
                  </th>
                  <th scope="col">State</th>
                </tr>
              </thead>
              <tbody>
                {data.jobs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      Nothing scheduled yet.
                    </td>
                  </tr>
                ) : (
                  data.jobs.map((j) => (
                    <tr key={`${j.orderId}-${j.lineId}`}>
                      <td className="mono">{j.lineId}</td>
                      <td className="mono">{j.orderId}</td>
                      <td className="num">{j.startHour}</td>
                      <td className="num">{j.endHour}</td>
                      <td>{j.frozen ? "started (frozen)" : "planned"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="eyebrow section">Open orders</p>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Type</th>
                  <th scope="col" className="num">
                    Qty
                  </th>
                  <th scope="col" className="num">
                    Due
                  </th>
                  <th scope="col">Rush</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.map((o) => (
                  <tr key={o.orderId}>
                    <td className="mono">{o.orderId}</td>
                    <td className="mono">
                      {o.lineType}/{o.partFamily}
                    </td>
                    <td className="num">{o.qty}</td>
                    <td className="num">{o.dueHour}</td>
                    <td>{o.rush ? "rush" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-label="Proposals">
          {data.pendingAttempts > 0 && (
            <p className="notice notice-warn" role="status" style={{ marginBottom: 16 }}>
              {data.pendingAttempts} operator call{data.pendingAttempts === 1 ? "" : "s"} in progress…
            </p>
          )}
          {data.proposals.length === 0 ? (
            <div className="placeholder">No proposals in this session yet.</div>
          ) : (
            data.proposals.map((p) => (
              <ProposalCard
                key={p.proposalId}
                sessionId={data.session.sessionId}
                p={p}
                release={data.releases.find((r) => r.manifestHash === p.manifestHash)}
                canApprove={canApprove}
              />
            ))
          )}
        </section>
      </div>
    </>
  );
}
