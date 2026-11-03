"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CHECK, LEVEL, shortHash } from "../../labels";

type Evidence = NonNullable<FunctionReturnType<typeof api.evidence.forAction>>;

// Evidence viewer (SPEC §12): refused action → reason → permission change →
// monitor window → reviews and outcomes → manifest diff. Public, read-only,
// replay sessions only. Every screen of the replay carries the
// fault-injection banner.

/**
 * The one-sentence headline for the refusal: what happened, and whether
 * anything was executed. UI-GUIDE §9: "A blocked state must say whether
 * execution occurred."
 */
export function outcomeHeadline(e: Pick<Evidence, "action" | "execution" | "plannedJobs">): string {
  // TODO(human)
  return "";
}

export default function EvidencePage() {
  const { actionId } = useParams<{ actionId: string }>();
  const e = useQuery(api.evidence.forAction, { actionId: actionId as Id<"actions"> });

  if (e === undefined) return <p className="intro muted">Loading evidence…</p>;
  if (e === null) {
    return (
      <section className="intro">
        <p className="eyebrow">Evidence</p>
        <h1 className="page-title">No public evidence for this action</h1>
        <p className="lede">Only actions from the recorded fault-injection replay are public.</p>
      </section>
    );
  }

  return (
    <main>
      <p className="notice notice-warn section" role="note">
        <strong>Fault injection.</strong> {e.label}
      </p>
      <section className="intro" style={{ paddingTop: 32 }}>
        <p className="eyebrow">Evidence · refused action</p>
        <h1 className="page-title" data-testid="headline">
          {outcomeHeadline(e)}
        </h1>
        <p className="lede">
          Follow the chain from the refusal back to the reviews that triggered it. Each step is a stored record.
        </p>
      </section>

      <ol className="evidence-chain">
        <Step n={1} title="Refused action">
          <dl className="kv">
            <dt>Reason</dt>
            <dd data-testid="reason">{e.action.refusalReason ?? "—"}</dd>
            <dt>Queued under</dt>
            <dd>{e.action.queuedUnder} autonomy, for shift {e.action.dueShift}</dd>
            <dt>Executed</dt>
            <dd data-testid="executed">{e.execution?.executed ? "yes" : "no"}</dd>
            <dt>State version</dt>
            <dd>
              {e.execution?.stateVersionBefore} → {e.execution?.stateVersionAfter} (unchanged means no business-state write)
            </dd>
            <dt>Jobs it would have written</dt>
            <dd>{e.plannedJobs.map((j) => `${j.orderId} ${j.lineId} ${j.startHour}–${j.endHour}`).join(" · ") || "none"}</dd>
          </dl>
        </Step>

        <Step n={2} title="Permission change it cites">
          {e.permissionChange ? (
            <dl className="kv">
              <dt>Change</dt>
              <dd data-testid="permission-change">
                {LEVEL[e.permissionChange.from]} → {LEVEL[e.permissionChange.to]}
              </dd>
              <dt>Trigger</dt>
              <dd>{e.permissionChange.trigger.replaceAll("_", " ")}</dd>
              <dt>Note</dt>
              <dd>{e.permissionChange.note ?? "—"}</dd>
            </dl>
          ) : (
            <p className="muted">No permission change recorded.</p>
          )}
        </Step>

        <Step n={3} title="Monitor window that signalled">
          {e.window ? (
            <dl className="kv">
              <dt>Window</dt>
              <dd>
                days {e.window.startDay}–{e.window.endDay}, evaluated day {e.window.evaluatedOnDay}
              </dd>
              <dt>Review agreement</dt>
              <dd data-testid="window-agreement">
                {e.window.x}/{e.window.n} agreed · {e.window.pending} pending (never counted as agreement)
              </dd>
              <dt>Test</dt>
              <dd>
                P(X ≤ {e.window.x} | n = {e.window.n}, p₀ = {e.window.p0}) = {e.window.pValue?.toExponential(2) ?? "—"} ≤ α ={" "}
                {e.window.alpha}
              </dd>
            </dl>
          ) : (
            <p className="muted">No monitor window recorded.</p>
          )}
        </Step>

        <Step n={4} title="Reviews in that window">
          <p className="small muted" style={{ marginBottom: 8 }}>
            Synthetic reviewer (rule checks + duration). Showing {e.reviews.shown.length} of {e.reviews.total}.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Reasons</th>
                </tr>
              </thead>
              <tbody>
                {e.reviews.shown.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.proposalDay}</td>
                    <td>{r.agreed === null ? "pending" : r.agreed ? "agreed" : "edited"}</td>
                    <td className="small">{r.reasons.map((x) => `${x} ${CHECK[x] ?? (x === "DURATION" ? "duration off by more than 10%" : "")}`).join("; ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Step>

        <Step n={5} title="What the fix changes">
          {e.manifestDiff ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Field</th>
                    <th scope="col">{e.manifestDiff.refused.operatorVersion} (refused)</th>
                    <th scope="col">{e.manifestDiff.fix.operatorVersion} (fix)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="mono small">manifest</td>
                    <td className="mono small">{shortHash(e.manifestDiff.refused.manifestHash)}</td>
                    <td className="mono small">{shortHash(e.manifestDiff.fix.manifestHash)}</td>
                  </tr>
                  <tr className="diff-changed">
                    <td className="mono small">dataView.includeMesCycleTimes</td>
                    <td className="mono small">{String(e.manifestDiff.refused.dataView.includeMesCycleTimes)}</td>
                    <td className="mono small">{String(e.manifestDiff.fix.dataView.includeMesCycleTimes)}</td>
                  </tr>
                  <tr className="diff-changed">
                    <td className="mono small">dataView.maxDataAgeShifts</td>
                    <td className="mono small">{String(e.manifestDiff.refused.dataView.maxDataAgeShifts ?? "default")}</td>
                    <td className="mono small">{String(e.manifestDiff.fix.dataView.maxDataAgeShifts ?? "default")}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">No manifest diff available.</p>
          )}
        </Step>
      </ol>

      <p className="section">
        <Link href="/" className="link-button">
          Back to results
        </Link>
      </p>
    </main>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="panel evidence-step">
      <p className="eyebrow">Step {n}</p>
      <h2 className="panel-title" style={{ marginBottom: 12 }}>
        {title}
      </h2>
      {children}
    </li>
  );
}
