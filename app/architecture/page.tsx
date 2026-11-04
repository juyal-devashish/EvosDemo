import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PlanPath, PlanToChange, SystemMap, TrustLadder } from "./figures";

export const metadata: Metadata = {
  title: "Architecture · EvosDemo",
  description:
    "Four diagrams of how EvosDemo works: where things run, how a plan is made, how it becomes a factory change or a refusal, and how trust moves.",
};

// Static page: no data, no sign-in. Each figure makes one claim, stated in its caption.

const FIGURES: { id: string; title: string; caption: string; figure: ReactNode }[] = [
  {
    id: "where",
    title: "1 · Where things run",
    caption:
      "The browser only ever talks to Convex. Convex alone holds the state, the Anthropic key and the safety rules.",
    figure: <SystemMap />,
  },
  {
    id: "plan",
    title: "2 · How a plan is made",
    caption:
      "Money is reserved before the model is called, and the plan is stored in the same transaction that settles the cost.",
    figure: <PlanPath />,
  },
  {
    id: "change",
    title: "3 · How a plan becomes a change, or a refusal",
    caption:
      "A queued plan is checked again at the moment it would run, and a demotion is committed before the queue is released. That ordering is what makes the headline refusal happen.",
    figure: <PlanToChange />,
  },
  {
    id: "trust",
    title: "4 · How trust moves",
    caption:
      "Trust belongs to one manifest in one session. It goes up only with evidence and a person, and it goes down automatically.",
    figure: <TrustLadder />,
  },
];

export default function ArchitecturePage() {
  return (
    <main className="arch">
      <section className="intro">
        <p className="eyebrow">System map</p>
        <h1 className="page-title">How EvosDemo works</h1>
        <p className="lede">
          Four pictures: where things run, how a plan is made, how a plan becomes a factory change (or is refused), and how
          trust moves up and down.
        </p>
        <ul className="arch-legend" aria-label="How to read the arrows">
          <li>
            <span className="key" />
            data or control flow
          </li>
          <li>
            <span className="key key-a" />
            the path that costs money or executes
          </li>
          <li>
            <span className="key key-d" />
            refusal or automatic demotion
          </li>
          <li>
            <span className="key key-x" />
            dashed: labeled test path, or never runs
          </li>
        </ul>
      </section>

      {FIGURES.map((f) => (
        <section key={f.id} className="section" aria-labelledby={`fig-${f.id}`}>
          <h2 id={`fig-${f.id}`} className="panel-title">
            {f.title}
          </h2>
          <p className="arch-cap">{f.caption}</p>
          <figure className="arch-frame">{f.figure}</figure>
        </section>
      ))}

      <p className="small muted section">
        Drawn from the code: convex/operator.ts, convex/execute.ts, convex/boundary.ts, convex/monitor.ts and
        convex/permissions.ts. The demotion, recovery and monitoring rules are this project&apos;s own design, not Evos&apos;s.
      </p>
    </main>
  );
}
