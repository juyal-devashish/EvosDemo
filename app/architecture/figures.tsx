// The four architecture diagrams, as inline SVG. The coordinates are tuned by hand
// (shared baselines, even gaps), so edit them directly. Colors and type come from the
// `.arch` rules in globals.css, which keeps every figure on the site's tokens.

export function SystemMap() {
  return (
      <svg viewBox="0 0 960 480" role="img" aria-label="System map: the browser app on Vercel talks only to Convex; Convex holds the database and talks to Claude, Clerk and Sentry.">
        <defs>
          <marker id="ah-f1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" className="mk"/>
          </marker>
          <marker id="aa-f1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" className="mk-a"/>
          </marker>
          <marker id="ad-f1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" className="mk-d"/>
          </marker>
        </defs>
        <rect className="zone" x="16" y="40" width="240" height="424" rx="12"/>
        <text className="eb" x="32" y="62">VERCEL · NEXT.JS 16</text>
        <rect className="node" x="32" y="80" width="208" height="72" rx="8"/>
        <text className="tx" x="46" y="102">Public pages</text>
        <text className="ts" x="46" y="120">results · replay · evidence</text>
        <text className="ts" x="46" y="136">no login, read-only</text>
        <rect className="node" x="32" y="166" width="208" height="72" rx="8"/>
        <text className="tx" x="46" y="188">Review panel</text>
        <text className="ts" x="46" y="206">planner and qa</text>
        <text className="ts" x="46" y="222">inspect and approve plans</text>
        <rect className="node" x="32" y="252" width="208" height="72" rx="8"/>
        <text className="tx" x="46" y="274">QA console</text>
        <text className="ts" x="46" y="292">qa only</text>
        <text className="ts" x="46" y="308">authorize · run · advance</text>
        <rect className="node" x="32" y="338" width="208" height="72" rx="8"/>
        <text className="tx" x="46" y="360">proxy.ts</text>
        <text className="ts" x="46" y="378">carries the Clerk session</text>
        <text className="ts" x="46" y="394">makes no access decisions</text>
        <rect className="zone" x="352" y="40" width="336" height="424" rx="12"/>
        <text className="eb" x="368" y="62">CONVEX · STATE AND LOGIC</text>
        <rect className="node" x="368" y="80" width="144" height="68" rx="8"/>
        <text className="tx" x="382" y="102">Queries</text>
        <text className="ts" x="382" y="120">read-only,</text>
        <text className="ts" x="382" y="136">role-aware</text>
        <rect className="node" x="528" y="80" width="144" height="68" rx="8"/>
        <text className="tx" x="542" y="102">Mutations</text>
        <text className="ts" x="542" y="120">requireRole on</text>
        <text className="ts" x="542" y="136">every one</text>
        <rect className="node" x="368" y="164" width="144" height="68" rx="8"/>
        <text className="tx" x="382" y="186">Actions</text>
        <text className="ts" x="382" y="204">propose · suite</text>
        <text className="ts" x="382" y="220">· replay</text>
        <rect className="node node-accent" x="528" y="164" width="144" height="68" rx="8"/>
        <text className="tx tx-a" x="542" y="186">executeAction</text>
        <text className="ts" x="542" y="204">one atomic</text>
        <text className="ts" x="542" y="220">transaction</text>
        <rect className="node" x="368" y="248" width="144" height="68" rx="8"/>
        <text className="tx" x="382" y="270">Scheduler</text>
        <text className="ts" x="382" y="288">trial fan-out,</text>
        <text className="ts" x="382" y="304">shift boundary</text>
        <rect className="node" x="528" y="248" width="144" height="68" rx="8"/>
        <text className="tx" x="542" y="270">Monitor</text>
        <text className="ts" x="542" y="288">review windows,</text>
        <text className="ts" x="542" y="304">automatic demotion</text>
        <path className="ln" d="M376 322 V334 H664 V322"/>
        <path className="ln" d="M520 334 V348" markerEnd="url(#ah-f1)"/>
        <rect className="node" x="368" y="348" width="304" height="108" rx="8"/>
        <text className="tx" x="382" y="370">Database</text>
        <text className="ts" x="382" y="388">22 tables, every row carries sessionId</text>
        <text className="ts" x="382" y="404">revisions, approvals and permission changes</text>
        <text className="ts" x="382" y="420">are append-only: nothing updates them</text>
        <text className="ts" x="382" y="436">everything above reads and writes here</text>
        <rect className="zone" x="760" y="40" width="184" height="424" rx="12"/>
        <text className="eb" x="776" y="62">EXTERNAL</text>
        <rect className="node" x="776" y="80" width="152" height="88" rx="8"/>
        <text className="tx" x="790" y="102">Claude API</text>
        <text className="ts" x="790" y="120">Opus 5.5, effort low</text>
        <text className="ts" x="790" y="136">the key exists only</text>
        <text className="ts" x="790" y="152">inside Convex</text>
        <rect className="node" x="776" y="204" width="152" height="88" rx="8"/>
        <text className="tx" x="790" y="226">Clerk</text>
        <text className="ts" x="790" y="244">sign-in happens in</text>
        <text className="ts" x="790" y="260">the browser; Convex</text>
        <text className="ts" x="790" y="276">only verifies the JWT</text>
        <rect className="node" x="776" y="328" width="152" height="88" rx="8"/>
        <text className="tx" x="790" y="350">Sentry</text>
        <text className="ts" x="790" y="368">app errors, plus</text>
        <text className="ts" x="790" y="384">demoted · refused ·</text>
        <text className="ts" x="790" y="400">incomplete events</text>
        <path className="ln" d="M256 262 H352" markerStart="url(#ah-f1)" markerEnd="url(#ah-f1)"/>
        <text className="ts" x="304" y="238" textAnchor="middle">live queries</text>
        <text className="ts" x="304" y="252" textAnchor="middle">and mutations</text>
        <path className="ln ln-a" d="M688 124 H776" markerEnd="url(#aa-f1)"/>
        <text className="ts" x="732" y="98" textAnchor="middle">one call</text>
        <text className="ts" x="732" y="112" textAnchor="middle">per plan</text>
        <path className="ln" d="M776 262 H688" markerEnd="url(#ah-f1)"/>
        <text className="ts" x="732" y="238" textAnchor="middle">JWT with</text>
        <text className="ts" x="732" y="252" textAnchor="middle">role claim</text>
        <path className="ln" d="M688 372 H776" markerEnd="url(#ah-f1)"/>
        <text className="ts" x="732" y="348" textAnchor="middle">events sent</text>
        <text className="ts" x="732" y="362" textAnchor="middle">after commit</text>
      </svg>
  );
}

export function PlanPath() {
  return (
      <svg viewBox="0 0 960 296" role="img" aria-label="Four steps from request to stored plan: build the input, reserve budget, call Claude, then settle cost and store the plan in one transaction.">
        <defs>
          <marker id="ah-f2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" className="mk"/>
          </marker>
          <marker id="aa-f2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" className="mk-a"/>
          </marker>
          <marker id="ad-f2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" className="mk-d"/>
          </marker>
        </defs>
        <rect className="node" x="16" y="24" width="200" height="112" rx="8"/>
        <text className="tx" x="30" y="46">1  Build the input</text>
        <text className="ts" x="30" y="64">load the release (manifest)</text>
        <text className="ts" x="30" y="80">and the factory snapshot</text>
        <text className="ts" x="30" y="96">send only what its data view</text>
        <text className="ts" x="30" y="112">allows; record sources + ages</text>
        <path className="ln" d="M216 80 H256" markerEnd="url(#ah-f2)"/>
        <path className="ln ln-dash" d="M116 136 V176"/>
        <rect className="node node-tag" x="16" y="176" width="200" height="52" rx="8"/>
        <text className="eb" x="30" y="196">reads</text>
        <text className="tm" x="30" y="214">manifest, factory, ages</text>
        <rect className="node" x="256" y="24" width="200" height="112" rx="8"/>
        <text className="tx" x="270" y="46">2  Reserve budget</text>
        <text className="ts" x="270" y="64">worst-case cost of this call</text>
        <text className="ts" x="270" y="80">is set aside before it starts</text>
        <text className="ts" x="270" y="96">over $18 → no call is made:</text>
        <text className="ts" x="270" y="112">status budget_blocked</text>
        <path className="ln" d="M456 80 H496" markerEnd="url(#ah-f2)"/>
        <path className="ln ln-dash" d="M356 136 V176"/>
        <rect className="node node-tag" x="256" y="176" width="200" height="52" rx="8"/>
        <text className="eb" x="270" y="196">writes</text>
        <text className="tm" x="270" y="214">attempt, reservation</text>
        <rect className="node" x="496" y="24" width="200" height="112" rx="8"/>
        <text className="tx" x="510" y="46">3  Call Claude</text>
        <text className="ts" x="510" y="64">model, effort and token limit</text>
        <text className="ts" x="510" y="80">all come from the manifest</text>
        <text className="ts" x="510" y="96">one call, no retries;</text>
        <text className="ts" x="510" y="112">reply parsed against the schema</text>
        <path className="ln ln-a" d="M696 80 H736" markerEnd="url(#aa-f2)"/>
        <path className="ln ln-dash" d="M596 136 V176"/>
        <rect className="node node-tag" x="496" y="176" width="200" height="52" rx="8"/>
        <text className="eb" x="510" y="196">no database access</text>
        <text className="tm" x="510" y="214">while the API call runs</text>
        <rect className="node node-accent" x="736" y="24" width="200" height="112" rx="8"/>
        <text className="tx tx-a" x="750" y="46">4  Settle and store</text>
        <text className="ts" x="750" y="64">actual cost replaces the estimate</text>
        <text className="ts" x="750" y="80">attempt recorded either way:</text>
        <text className="ts" x="750" y="96">ok, refusal, timeout, parse fail</text>
        <text className="ts" x="750" y="112">if ok: plan + guardrail result</text>
        <path className="ln ln-dash" d="M836 136 V176"/>
        <rect className="node node-tag" x="736" y="176" width="200" height="52" rx="8"/>
        <text className="eb" x="750" y="196">writes, one transaction</text>
        <text className="tm" x="750" y="214">attempt, proposal, rev 1</text>
        <text className="tm" x="16" y="262">returns a receipt: attemptId · status · proposalId · revisionId · costUsd</text>
        <text className="ts" x="16" y="282">the plan itself stays in the stored revision; nothing here approves or runs it</text>
      </svg>
  );
}

export function PlanToChange() {
  return (
      <svg viewBox="0 0 960 660" role="img" aria-label="A queued plan waits for the shift boundary. The boundary closes the period, commits any demotion, then releases the queue. executeAction re-checks permission, approval and guardrails, then writes the diff or records a refusal.">
        <defs>
          <marker id="ah-f3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" className="mk"/>
          </marker>
          <marker id="aa-f3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" className="mk-a"/>
          </marker>
          <marker id="ad-f3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" className="mk-d"/>
          </marker>
        </defs>
        <rect className="node" x="16" y="44" width="212" height="72" rx="8"/>
        <text className="tx" x="30" y="66">Supervised</text>
        <text className="ts" x="30" y="84">a person approves</text>
        <text className="ts" x="30" y="100">bound to this revision</text>
        <rect className="node" x="16" y="132" width="212" height="72" rx="8"/>
        <text className="tx" x="30" y="154">Limited autonomy</text>
        <text className="ts" x="30" y="172">queued without approval</text>
        <text className="ts" x="30" y="188">reviewed afterwards</text>
        <rect className="node node-muted" x="16" y="220" width="212" height="60" rx="8"/>
        <text className="tx" x="30" y="242">Shadow</text>
        <text className="ts" x="30" y="260">recorded, but never runs</text>
        <rect className="node" x="288" y="88" width="190" height="84" rx="8"/>
        <text className="tx" x="302" y="110">Action queue</text>
        <text className="ts" x="302" y="128">one plan per scope</text>
        <text className="ts" x="302" y="144">per shift; a newer</text>
        <text className="ts" x="302" y="160">approved plan replaces</text>
        <path className="ln" d="M228 80 H258 V120 H288" markerEnd="url(#ah-f3)"/>
        <path className="ln" d="M228 168 H258 V140 H288" markerEnd="url(#ah-f3)"/>
        <rect className="zone" x="540" y="28" width="404" height="264" rx="12"/>
        <text className="eb" x="556" y="50">SHIFT BOUNDARY · ORDERED, RESUMABLE</text>
        <rect className="node" x="556" y="60" width="372" height="52" rx="8"/>
        <text className="tx" x="570" y="82">1  Close the period</text>
        <text className="ts" x="570" y="100">the clock moves forward one shift</text>
        <rect className="node node-accent" x="556" y="130" width="372" height="52" rx="8"/>
        <text className="tx tx-a" x="570" y="152">2  Evaluate the monitor</text>
        <text className="ts" x="570" y="170">any demotion is committed here, before step 3</text>
        <rect className="node" x="556" y="200" width="372" height="52" rx="8"/>
        <text className="tx" x="570" y="222">3  Release the queue</text>
        <text className="ts" x="570" y="240">executeAction runs for each due action</text>
        <path className="ln" d="M742 112 V130" markerEnd="url(#ah-f3)"/>
        <path className="ln" d="M742 182 V200" markerEnd="url(#ah-f3)"/>
        <path className="ln" d="M478 130 H508 V226 H556" markerEnd="url(#ah-f3)"/>
        <path className="ln" d="M742 252 V314 H330 V340" markerEnd="url(#ah-f3)"/>
        <text className="ts" x="536" y="308" textAnchor="middle">each due action</text>
        <text className="eb" x="32" y="328">EXECUTEACTION · ONE TRANSACTION</text>
        <rect className="node" x="32" y="340" width="320" height="48" rx="8"/>
        <text className="tx" x="46" y="362">1  Already executed?</text>
        <text className="ts" x="46" y="380">yes → return the stored result</text>
        <rect className="node" x="32" y="400" width="320" height="48" rx="8"/>
        <text className="tx" x="46" y="422">2  Permission right now?</text>
        <text className="ts" x="46" y="440">read at this moment, not at approval</text>
        <rect className="node" x="32" y="460" width="320" height="48" rx="8"/>
        <text className="tx" x="46" y="482">3  Approval valid?</text>
        <text className="ts" x="46" y="500">this revision, this manifest</text>
        <rect className="node" x="32" y="520" width="320" height="48" rx="8"/>
        <text className="tx" x="46" y="542">4  Re-run G1–G8</text>
        <text className="ts" x="46" y="560">on the factory as it is now</text>
        <rect className="node node-accent" x="32" y="588" width="320" height="48" rx="8"/>
        <text className="tx tx-a" x="46" y="610">5  Write the diff</text>
        <text className="ts" x="46" y="628">exactly what was approved</text>
        <path className="ln" d="M192 388 V400" markerEnd="url(#ah-f3)"/>
        <path className="ln" d="M192 448 V460" markerEnd="url(#ah-f3)"/>
        <path className="ln" d="M192 508 V520" markerEnd="url(#ah-f3)"/>
        <path className="ln ln-a" d="M192 568 V588" markerEnd="url(#aa-f3)"/>
        <text className="ts tx-a" x="204" y="582" textAnchor="start">all pass</text>
        <rect className="node node-muted" x="520" y="340" width="424" height="48" rx="8"/>
        <text className="tx" x="534" y="362">Retry-safe</text>
        <text className="ts" x="534" y="380">a repeated call returns the stored result; nothing runs twice</text>
        <path className="ln" d="M352 364 H520" markerEnd="url(#ah-f3)"/>
        <rect className="node node-danger" x="520" y="400" width="424" height="170" rx="8"/>
        <text className="tx tx-d" x="534" y="422">Refused</text>
        <text className="ts tx-d" x="534" y="440">reason, evidence ids and an audit entry are recorded</text>
        <text className="ts tx-d" x="534" y="456">state version unchanged</text>
        <text className="ts tx-d" x="534" y="472">returns normally and never throws: a thrown</text>
        <text className="ts tx-d" x="534" y="488">mutation would roll back its own refusal record</text>
        <path className="ln ln-d" d="M352 424 H520" markerEnd="url(#ad-f3)"/>
        <text className="ts tx-d" x="436" y="418" textAnchor="middle">shadow</text>
        <path className="ln ln-d" d="M352 484 H520" markerEnd="url(#ad-f3)"/>
        <text className="ts tx-d" x="436" y="478" textAnchor="middle">no valid approval</text>
        <path className="ln ln-d" d="M352 544 H520" markerEnd="url(#ad-f3)"/>
        <text className="ts tx-d" x="436" y="538" textAnchor="middle">a guardrail fails</text>
        <rect className="node node-accent" x="520" y="588" width="424" height="48" rx="8"/>
        <text className="tx tx-a" x="534" y="610">Executed</text>
        <text className="ts" x="534" y="628">writes exactly the diff; state version +1; execution recorded</text>
        <path className="ln ln-a" d="M352 612 H520" markerEnd="url(#aa-f3)"/>
      </svg>
  );
}

export function TrustLadder() {
  return (
      <svg viewBox="0 0 960 322" role="img" aria-label="Trust ladder: Shadow to Supervised with a passed suite and QA; Supervised to Limited through the recovery gate; Limited to Demoted automatically on a monitor alarm; Demoted back to Limited through the recovery gate.">
        <defs>
          <marker id="ah-f4" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" className="mk"/>
          </marker>
          <marker id="aa-f4" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" className="mk-a"/>
          </marker>
          <marker id="ad-f4" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" className="mk-d"/>
          </marker>
        </defs>
        <rect className="node" x="40" y="120" width="150" height="64" rx="8"/>
        <text className="tx" x="115.0" y="142" textAnchor="middle">Shadow</text>
        <text className="ts" x="115.0" y="160" textAnchor="middle">suggests only</text>
        <rect className="node" x="290" y="120" width="150" height="64" rx="8"/>
        <text className="tx" x="365.0" y="142" textAnchor="middle">Supervised</text>
        <text className="ts" x="365.0" y="160" textAnchor="middle">approves every plan</text>
        <rect className="node node-accent" x="540" y="120" width="150" height="64" rx="8"/>
        <text className="tx tx-a" x="615.0" y="142" textAnchor="middle">Limited autonomy</text>
        <text className="ts" x="615.0" y="160" textAnchor="middle">acts on its own</text>
        <rect className="node node-danger" x="790" y="120" width="150" height="64" rx="8"/>
        <text className="tx tx-d" x="865.0" y="142" textAnchor="middle">Demoted</text>
        <text className="ts tx-d" x="865.0" y="160" textAnchor="middle">acts as supervised</text>
        <path className="ln ln-a" d="M190 168 H290" markerEnd="url(#aa-f4)"/>
        <text className="ts" x="240" y="142" textAnchor="middle">suite passed</text>
        <text className="ts" x="240" y="156" textAnchor="middle">+ QA</text>
        <path className="ln ln-a" d="M440 168 H540" markerEnd="url(#aa-f4)"/>
        <text className="ts" x="490" y="156" textAnchor="middle">recovery gate</text>
        <path className="ln ln-d" d="M690 168 H790" markerEnd="url(#ad-f4)"/>
        <text className="ts tx-d" x="740" y="142" textAnchor="middle">monitor alarm</text>
        <text className="ts tx-d" x="740" y="156" textAnchor="middle">automatic</text>
        <path className="ln ln-a" d="M865 184 V228 H615 V190" markerEnd="url(#aa-f4)"/>
        <text className="ts" x="740" y="246" textAnchor="middle">recovery gate</text>
        <path className="ln ln-dash" d="M115 120 V60 H615 V114" markerEnd="url(#ah-f4)"/>
        <text className="ts" x="365" y="52" textAnchor="middle">labeled fault-injection override (replay session only)</text>
        <text className="ts" x="40" y="286">A new manifest starts at Shadow. Trust never transfers from one manifest to another.</text>
        <text className="ts" x="40" y="306">Recovery gate: rs-1.0 passed including slow-machine · at least 80 fresh supervised reviews · 95% lower bound ≥ 90% · QA authorizes.</text>
      </svg>
  );
}
