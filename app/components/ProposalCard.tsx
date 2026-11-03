"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { describeError } from "../errors";
import { CHECK, shortHash } from "../labels";

type SessionView = FunctionReturnType<typeof api.review.session>;
export type ProposalView = SessionView["proposals"][number];
type Release = SessionView["releases"][number];

const GUARDRAILS = ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"] as const;

/** Card state from backend records only. Never optimistic. */
function stateOf(p: ProposalView): { label: string; cls: string } {
  const action = p.actions.at(-1);
  if (!p.revision.check.ok) return { label: "Blocked by guardrails", cls: "badge-fail" };
  if (action?.state === "executed") return { label: "Applied", cls: "badge-pass" };
  if (action?.state === "refused") return { label: `Refused: ${action.refusalReason}`, cls: "badge-fail" };
  if (action?.state === "failed") return { label: "Write failed", cls: "badge-fail" };
  if (action?.state === "queued") return { label: `Approved · queued for shift ${action.dueShift}`, cls: "badge-neutral" };
  return { label: "Awaiting review", cls: "badge-warn" };
}

export function ProposalCard({
  sessionId,
  p,
  release,
  canApprove,
}: {
  sessionId: SessionView["session"]["sessionId"];
  p: ProposalView;
  release: Release | undefined;
  canApprove: boolean;
}) {
  const approve = useMutation(api.queue.approve);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = stateOf(p);
  const failedIds = new Set(p.revision.check.failures.map((f) => f.id));
  const alreadyApproved = p.approvals.length > 0;

  async function onApprove() {
    setBusy(true);
    setError(null);
    try {
      await approve({ sessionId, revisionId: p.revision.revisionId });
    } catch (e) {
      setError(describeError(e, { operatorVersion: p.operatorVersion }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="panel card" data-testid="proposal-card">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Production scheduling</p>
          <h3 className="panel-title">
            {p.operatorVersion} · revision {p.revision.revisionNumber}
          </h3>
          <p className="mono small muted">
            manifest {shortHash(p.manifestHash)} · shift {p.shift} · {p.trigger}
          </p>
        </div>
        <span className={`badge ${state.cls}`} data-testid="proposal-state">
          {state.label}
        </span>
      </div>

      <ul className="checklist" aria-label="Guardrail checks">
        {GUARDRAILS.map((id) => {
          const failed = failedIds.has(id);
          return (
            <li key={id} className={failed ? "check-fail" : "check-pass"}>
              <span className="check-icon" aria-hidden="true">
                {failed ? "✕" : "✓"}
              </span>
              <span>
                <span className="mono">{id}</span> {CHECK[id]}
                <span className="sr-only">{failed ? " failed" : " passed"}</span>
                {p.revision.check.failures
                  .filter((f) => f.id === id)
                  .map((f, i) => (
                    <span key={i} className="check-reason mono">
                      {f.orderId ? `${f.orderId}: ` : ""}
                      {f.message}
                    </span>
                  ))}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="table-wrap section">
        <table>
          <thead>
            <tr>
              <th scope="col">Order</th>
              <th scope="col">Status</th>
              <th scope="col">Commitment</th>
              <th scope="col">Line</th>
              <th scope="col" className="num">
                Start
              </th>
              <th scope="col" className="num">
                Finish
              </th>
              <th scope="col" className="num">
                Can&apos;t finish before
              </th>
            </tr>
          </thead>
          <tbody>
            {p.revision.dispositions.map((d) => {
              const job = p.revision.schedule.find((j) => j.orderId === d.orderId);
              return (
                <tr key={d.orderId}>
                  <td className="mono">{d.orderId}</td>
                  <td>{d.status}</td>
                  <td>{d.commitment.replace("_", " ")}</td>
                  <td className="mono">{job?.lineId ?? "—"}</td>
                  <td className="num">{job ? job.startHour : "—"}</td>
                  <td className="num">{job ? job.endHour : "—"}</td>
                  <td className="num">{d.cannotFinishBefore ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {p.revision.escalations.length > 0 && (
        <div className="section">
          <p className="eyebrow">Escalations</p>
          <ul className="plain-list">
            {p.revision.escalations.map((e, i) => (
              <li key={i}>
                {e.orderId && <span className="mono">{e.orderId}: </span>}
                {e.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="section">
        <summary>Operator&apos;s summary and data sent</summary>
        <p className="small" style={{ marginTop: 8 }}>
          {p.revision.summary}
        </p>
        <p className="small muted" style={{ marginTop: 8 }}>
          Narrative only. Every number above comes from the structured plan.
        </p>
        {p.provenance && (
          <p className="mono small" style={{ marginTop: 8 }}>
            sent (server record):{" "}
            {p.provenance.sources.map((s) => `${s.source} age ${s.ageShifts}`).join(" · ")}
          </p>
        )}
      </details>

      <hr className="rule" />
      <div className="row">
        {canApprove && (
          <button
            className="button-primary"
            onClick={onApprove}
            disabled={busy || !p.revision.check.ok || alreadyApproved}
            data-testid="approve"
          >
            {busy ? "Approving…" : alreadyApproved ? "Approved" : "Approve schedule"}
          </button>
        )}
        {release?.level === "shadow" && (
          <span className="small muted">
            {p.operatorVersion} is in shadow mode: an approval is recorded, but shadow never executes.
          </span>
        )}
        {!p.revision.check.ok && <span className="small muted">Guardrail failures can&apos;t be approved, only corrected.</span>}
      </div>
      {error && (
        <p className="notice notice-error section" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}
