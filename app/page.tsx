"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { CHECK, EXPECTED_OUTCOME, shortHash } from "./labels";

type Overview = FunctionReturnType<typeof api.results.publicOverview>;
type ManifestResult = Overview["manifests"][number];

// Public results page (SPEC §12): suite verdicts and their evidence. No
// login and no controls that change anything. Every number is rendered
// from structured fields (T2); data-testid marks the ones Playwright checks.

export default function ResultsPage() {
  const data = useQuery(api.results.publicOverview, {});

  return (
    <main>
      <section className="intro">
        <p className="eyebrow">Act 1 · Release gate · real AI runs</p>
        <h1 className="page-title">Release suite results</h1>
        <p className="lede">
          Each operator release runs the same fixed suite of factory scenarios before it may act. A release that fails
          stays in shadow mode, where it can propose but never execute.
        </p>
      </section>

      {data === undefined ? (
        <p className="muted" role="status">
          Loading results…
        </p>
      ) : data.manifests.length === 0 ? (
        <div className="placeholder">No suite run has finished yet.</div>
      ) : (
        <Results data={data} />
      )}
    </main>
  );
}

function Results({ data }: { data: Overview }) {
  const totalTrials = data.manifests.reduce((n, m) => n + m.verdict.perScenario.reduce((k, s) => k + s.trials, 0), 0);
  return (
    <>
      <div className="metrics" aria-label="Summary">
        <Metric label="Suite" value={data.suiteVersion} testId="suite-version" />
        <Metric label="Scenarios" value={String(data.scenarios.length)} testId="scenario-count" />
        <Metric label="Trials recorded" value={String(totalTrials)} testId="trial-total" />
        <Metric
          label="API spend"
          value={`$${data.spentUsd.toFixed(2)}${data.capUsd === null ? "" : ` of $${data.capUsd}`}`}
          testId="spend"
        />
      </div>

      <div className="grid-2">
        {data.manifests.map((m) => (
          <ManifestPanel key={m.manifestHash} m={m} scenarios={data.scenarios} />
        ))}
      </div>

      {data.manifests.length >= 2 && <ManifestDiff a={data.manifests[0]} b={data.manifests[1]} />}

      <section className="section placeholder" aria-labelledby="act2">
        <p className="eyebrow">Act 2 · Fault-injection replay</p>
        <h2 id="act2" className="panel-title" style={{ margin: "6px 0" }}>
          Not recorded yet
        </h2>
        <p>
          A labeled replay will ask what happens if a defect like op-v1&apos;s slipped past the gate: the monitor demotes
          the operator and the backend refuses its queued action. It appears here once recorded.
        </p>
      </section>
    </>
  );
}

function Metric({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="metric">
      <div className="eyebrow">{label}</div>
      <div className="metric-value" data-testid={testId}>
        {value}
      </div>
    </div>
  );
}

function VerdictBadge({ kind }: { kind: "passed" | "failed" | "incomplete" }) {
  const map = {
    passed: { cls: "badge-pass", icon: "✓", text: "Passed" },
    failed: { cls: "badge-fail", icon: "✕", text: "Failed" },
    incomplete: { cls: "badge-warn", icon: "!", text: "Incomplete" },
  } as const;
  const b = map[kind];
  return (
    <span className={`badge ${b.cls}`}>
      <span aria-hidden="true">{b.icon}</span>
      {b.text}
    </span>
  );
}

function ManifestPanel({ m, scenarios }: { m: ManifestResult; scenarios: Overview["scenarios"] }) {
  return (
    <article className="panel" data-testid={`manifest-${m.operatorVersion}`} aria-labelledby={`h-${m.operatorVersion}`}>
      <div className="panel-head">
        <div>
          <p className="eyebrow">Operator release</p>
          <h2 id={`h-${m.operatorVersion}`} className="panel-title">
            {m.operatorVersion}
          </h2>
          <p className="mono small muted" title={m.manifestHash}>
            manifest {shortHash(m.manifestHash)}
          </p>
        </div>
        <VerdictBadge kind={m.verdict.kind} />
      </div>

      <p className="verdict-text" data-testid="verdict-text">
        {m.verdict.text}
      </p>

      <dl className="kv section">
        <dt>Model</dt>
        <dd>
          {m.model} · effort {m.effort}
        </dd>
        <dt>Observed cycle times</dt>
        <dd data-testid="data-view-mes">{m.dataView.includeMesCycleTimes ? "included" : "not included"}</dd>
        <dt>Freshness limit</dt>
        <dd>{m.dataView.maxDataAgeShifts === undefined ? "policy default" : `${m.dataView.maxDataAgeShifts} shifts`}</dd>
      </dl>

      <div className="table-wrap section">
        <table>
          <thead>
            <tr>
              <th scope="col">Scenario</th>
              <th scope="col">Expected</th>
              <th scope="col" className="num">
                Pass
              </th>
              <th scope="col" className="num">
                Fail
              </th>
              <th scope="col" className="num">
                Missing
              </th>
            </tr>
          </thead>
          <tbody>
            {m.verdict.perScenario.map((s) => {
              const sc = scenarios.find((x) => x.id === s.scenarioId);
              return (
                <tr key={s.scenarioId} data-testid={`row-${m.operatorVersion}-${s.scenarioId}`}>
                  <td>
                    <div>{sc?.family ?? s.scenarioId}</div>
                    <div className="mono small muted">{s.scenarioId}</div>
                  </td>
                  <td className="small">{sc ? (EXPECTED_OUTCOME[sc.expectedOutcome] ?? sc.expectedOutcome) : ""}</td>
                  <td className="num" data-testid="passed">
                    {s.passed}/{s.trials}
                  </td>
                  <td className="num" data-testid="failed" style={s.failed > 0 ? { color: "var(--danger)" } : undefined}>
                    {s.failed}
                  </td>
                  <td className="num" data-testid="missing">
                    {s.missing}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {m.examples.length > 0 && (
        <section className="section" aria-label={`Failure evidence for ${m.operatorVersion}`}>
          <p className="eyebrow">Failure evidence</p>
          {m.examples.map((e) => {
            const group = m.verdict.failures.find((g) => g.checkId === e.checkId && g.scenarioId === e.scenarioId)!;
            return (
              <div key={`${e.checkId}-${e.scenarioId}`} className="evidence">
                <div>
                  <span className="mono">{e.checkId}</span> {CHECK[e.checkId] ?? ""} ·{" "}
                  <span className="mono">{e.scenarioId}</span> ·{" "}
                  <span className="mono" data-testid={`failcount-${e.checkId}-${e.scenarioId}`}>
                    {group.failedTrials}/{group.trials}
                  </span>{" "}
                  trials
                </div>
                {e.trials.map((t) => (
                  <div key={t.trialKey} className="small">
                    {t.failures.map((f, i) => (
                      <div key={i}>
                        <span className="muted">Trial {t.index + 1}:</span>{" "}
                        {f.orderId ? <span className="mono">{f.orderId} </span> : null}
                        <span className="mono">{f.message}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            );
          })}
        </section>
      )}

      <p className="small muted section">
        Verdict uses each trial&apos;s first attempt. With 0 failures in {m.trialsPerScenario} trials, the one-sided 95%
        upper bound on a scenario&apos;s failure rate is{" "}
        {m.verdict.perScenario.find((s) => s.upperBound95 !== undefined)?.upperBound95 !== undefined
          ? `${(m.verdict.perScenario.find((s) => s.upperBound95 !== undefined)!.upperBound95! * 100).toFixed(0)}%`
          : "n/a"}
        , assuming independent trials.
      </p>
    </article>
  );
}

function ManifestDiff({ a, b }: { a: ManifestResult; b: ManifestResult }) {
  const rows: [string, string, string][] = [
    ["operatorVersion", a.operatorVersion, b.operatorVersion],
    ["model", a.model, b.model],
    ["effort", a.effort, b.effort],
    ["maxTokens", String(a.maxTokens), String(b.maxTokens)],
    ["promptHash", shortHash(a.promptHash), shortHash(b.promptHash)],
    ["dataView.includeMesCycleTimes", String(a.dataView.includeMesCycleTimes), String(b.dataView.includeMesCycleTimes)],
    [
      "dataView.maxDataAgeShifts",
      String(a.dataView.maxDataAgeShifts ?? "default"),
      String(b.dataView.maxDataAgeShifts ?? "default"),
    ],
    ["guardrailVersion", a.guardrailVersion, b.guardrailVersion],
    ["policyVersion", a.policyVersion, b.policyVersion],
    ["suiteVersion", a.suiteVersion, b.suiteVersion],
  ];
  return (
    <section className="panel section" aria-labelledby="diff">
      <p className="eyebrow">Manifest diff</p>
      <h2 id="diff" className="panel-title" style={{ marginBottom: 6 }}>
        What changed between {a.operatorVersion} and {b.operatorVersion}
      </h2>
      <p className="muted small" style={{ marginBottom: 16 }}>
        Permissions bind to the manifest hash, so any change here is a new release that starts in shadow mode.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">{a.operatorVersion}</th>
              <th scope="col">{b.operatorVersion}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, x, y]) => (
              <tr key={k} className={x !== y ? "diff-changed" : undefined}>
                <td className="mono small">
                  {k}
                  {x !== y && <span className="sr-only"> (changed)</span>}
                </td>
                <td className="mono small">{x}</td>
                <td className="mono small">{y}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
