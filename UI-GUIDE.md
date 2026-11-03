# Evos-inspired UI guide for the manufacturing demo

Inspected: November 3, 2026.
Purpose: reproduce the visual character of Evos's public website in an independently built manufacturing demo.

## 1. Reference and confidence

Inspected visually in a live browser:
- [Manufacturing page](https://getevos.ai/solutions/manufacturing): hero, illustrated operator card, catalogue table; full page content.
- [Homepage](https://getevos.ai/): centered hero and layered operator-card presentation.

Computed typography and colors were sampled from rendered DOM elements at a desktop viewport of 1144 × 795 CSS pixels. Sizes below are measurements at that viewport, not universal breakpoints. Some card colors change during animation.

This is a guide to the public marketing site's visual language. The authenticated Evos application was not inspected. Recommended dashboard layouts, responsive behavior, semantic error colors, and component dimensions are adaptations for this demo, not claims about Evos's internal design system.

## 2. Overall direction

Build a quiet, precise industrial-software interface:
- Warm, almost-white canvas and charcoal text.
- Generous whitespace around headings; compact, structured operational data below.
- Large, light sans-serif headlines alongside tiny, widely spaced monospace labels.
- Dark rectangular primary buttons with modest rounding.
- Fine dividers, softly rounded panels, understated neutral badges.
- Electric blue for active/progress states; orange for the manufacturing category and selected exception accents.
- Industrial photographs appear in marketing panels, darkened behind light operator cards.
- The visual emphasis is on a concrete job, its progress, and its next action.

For the demo, make the schedule and evidence the dominant content. One photo-backed introductory panel is optional; photography should not sit underneath dense charts or tables.

## 3. Measured palette

| Role observed | Value | Notes |
|---|---|---|
| Page canvas | #FFFFFC | Body background; warmer than pure white |
| Main text / dark buttons | #1E1E1E | Charcoal rather than absolute black |
| Muted copy | #6B6B6B | Eyebrow text and table headers |
| Announcement accent | #BDD13A | Yellow-green strip above navigation |
| Manufacturing category | #FF4400 | Compact orange table badges |
| Neutral category fill | #D7D7D7 | Sub-industry tags |
| Active/completed illustration accents | #0026FF | Blue dots, checks and progress marks |
| Additional green observed | #22C55E | Present in illustrative status elements; not the dominant brand accent |
| Light operator-card surface | rgba(255,254,251,0.90) and nearby variants | Several translucent warm surfaces appeared |
| Subtle neutral fill | charcoal at about 5% opacity | Quiet backgrounds |

Use the lime color sparingly. It belongs to the site's announcement strip, not every primary action.

Suggested additions for the demo, NOT sampled brand tokens:
- Border: rgba(30,30,30,0.12).
- Blocked/error: #B42318 on #FEF3F2.
- Warning/review needed: #92400E on #FFFBEB.
- Successful verification: #166534 on #F0FDF4.
- Focus outline: #0026FF.

Always pair state colors with words and icons. Orange category badges do not automatically mean an error. Small white text on vivid colors should be contrast-tested before reuse.

## 4. Typography

### Observed

| Element | Family | Size | Weight | Other |
|---|---|---|---|---|
| Body | Inter | 17px | 400 | 26.35px line height |
| Manufacturing hero heading | Inter | 41.184px | 300 | 43.655px line height; approximately -0.02em tracking |
| Homepage hero heading | Inter | 57.2px | 300 | 61.776px line height |
| Manufacturing section heading sampled | Inter | 41.184px | 500 | Approximately 1.08 line height |
| Small section heading | Inter | 17px | 500 | 26.35px line height |
| Uppercase eyebrow | IBM Plex Mono | 12px | 400 | 2.4px tracking |
| Catalogue column labels | IBM Plex Mono | 11px | 400 | Uppercase; 0.88px tracking |
| Catalogue row number | IBM Plex Mono | 12px | 400 | 18.6px line height |
| Header primary button | Inter | 14px | 500 | 8px 16px padding |

Observed fallback stacks:
- Inter, "Inter Fallback", "Helvetica Neue", Helvetica, Arial, sans-serif.
- "IBM Plex Mono", "IBM Plex Mono Fallback", "Courier Prime", "Courier New", monospace.

### Demo adaptation

- App title: 36–44px, weight 300, tight tracking.
- Panel heading: 18–22px, weight 500.
- Normal interface text: 14–16px.
- Metadata / timestamps / evidence IDs: IBM Plex Mono, 11–12px.
- Table data: 12–14px; monospace for dates, numbers, IDs and technical results.
- Use tabular numerals for metric values.
- Keep explanatory paragraphs in Inter; do not render the entire application in monospace.
- Load both font families explicitly. A declared font name alone does not install the font.

## 5. Layout and spacing

### Observed patterns

The desktop manufacturing hero has a left text column and a larger right visual panel. At the inspected viewport, outer gutters were roughly 36px. Headline, paragraph and actions form one vertical group. The illustration occupies a rounded industrial-photo container, with a light operator card inside.

Below the hero, large whitespace and thin rules separate sections. The site alternates plain text sections, illustrated panels, industry tiles, and a dense operator catalogue.

The homepage uses a centered hero and overlapping photographic operator cards. Do not copy that carousel into the operational demo; it is a marketing presentation.

### Recommended dashboard composition

Use a centered shell with max-width around 1440px, 32px desktop gutters and 16px mobile gutters.

Suggested screen:
1. Compact top navigation: project identity, Factory / Review / Evidence links, simulation badge.
2. Page introduction: uppercase monospace context label, light heading, one short sentence.
3. Slim metrics strip: affected orders, pending review, current permission.
4. Main workspace: larger schedule/data area on the left, operator proposal card on the right.
5. Evidence area underneath, expanded when needed.

Spacing scale: 4, 8, 12, 16, 24, 32, 48, 64px.
Use 20–24px internal panel padding and 24px gaps between major panels.
Use whitespace before adding more containers or backgrounds.

## 6. Navigation and buttons

Observed header:
- Compact black symbol at the left.
- Text navigation with small downward chevrons.
- Right-aligned login link and dark primary button.
- Light header area below a lime announcement bar.

Demo adaptation:
- Use your own simple mark and the name "Earned Autonomy".
- Add a discreet "Independent manufacturing demo" label.
- Use a short top navigation rather than reproducing all marketing menus.
- A slim lime strip may say "Simulation · Northfield Circuits" if useful; avoid adding a decorative banner without information.

Buttons:
- Primary: charcoal background, warm-white text, 8px radius.
- Secondary: transparent/warm-white background, thin neutral border, dark text.
- Tertiary: clear text link with a subtle underline where appropriate.
- Recommended app control height: 40–44px.
- The small illustrative Approve control measured 12px type, 6px 14px padding, 7px radius. Make real interactive controls larger than that illustration.

Use direct labels: Run checks, Review plan, Approve schedule, View evidence.
Provide visible focus, loading, disabled and error states.

## 7. The operator card: the most useful pattern to borrow

The manufacturing hero shows a floating light card over an industrial image:
- Small uppercase mono operator label.
- A job/machine identifier underneath.
- Small status badge near the upper-right corner.
- A vertical checklist with circular progress/check icons.
- Thin separator above the action row.
- Dark approval control with muted adjacent guidance.
- A small floating exception notification above the card.
- Broad soft shadow around the outer visual panel.

The illustration animates through operational steps. Some completed steps appear struck through.

Adaptation for the actual demo:
- Header: PRODUCTION SCHEDULING.
- Context: Order 104 · SMT-2.
- State: Awaiting review / Blocked / Applied.
- Evidence-backed checklist: materials available, line eligible, no overlap, duration verified.
- Footer: one primary action and a View evidence link.
- Show factual reasons beneath failed checks.
- Use check icons plus text for completed real checks; avoid striking through important evidence.
- Never animate a task to success unless the underlying result changed.
- Illustrative status widgets on the website are design references, not specifications for real permission behavior.

Suggested card radius: 14–16px. Suggested outer visual radius: 18–20px.
Suggested shadow: 0 20px 48px rgba(30,30,30,0.12). These are recommendations, not measured exact values.

## 8. Tables, badges and filters

Observed catalogue:
- Rounded, lightly bordered outer frame.
- Thin horizontal row separators.
- Small uppercase mono headings.
- Dense monospace text and muted row numbers.
- Underlined operator-name links.
- Compact orange industry badges and gray sub-industry badges.
- Search field with a simple bottom border.
- Outlined Filter button and muted count aligned on the right.
- The wide table extends horizontally at the inspected viewport.

Demo adaptation:
- Columns: Order, Line, Start, Finish, Material status, Verification.
- Left-align descriptions; right-align quantities.
- Use a visible horizontal scroll container for wide schedules.
- Put detailed reasons in an expandable row or evidence panel.
- Keep badges compact with 4–6px rounding; reserve full pills for very short indicators if needed.
- Do not make every cell a badge.

## 9. Charts and evidence

These are demo recommendations; the public pages did not establish a chart design system.

Charts:
- Warm-white plotting area.
- Thin pale grid lines and small gray axis labels.
- Blue primary series; charcoal secondary series.
- A dashed threshold with an explicit label.
- A labeled incident marker, not just a red region.
- Show sample size, time units and simulation status.
- Keep decorative gradients and glow out of the plot.

Evidence panel:
- Top row: result, check name, time.
- Two columns: Expected / Observed.
- Below: concise explanation, source record IDs, before/after changes.
- Code/JSON may use a light neutral background with monospace type.
- A blocked state must say whether execution occurred.
- Keep simulation and independently built-demo labels visible but unobtrusive.

## 10. Motion and interaction

Observed: the hero's operational illustration moves through progress states; homepage cards overlap and transition.

Recommended implementation:
- Small 150–200ms color/opacity transitions.
- Optional 200–300ms panel reveal.
- Stable layouts while a check runs.
- No random counters, endless fake processing, or simulated success presented as live execution.
- Respect prefers-reduced-motion.
- Keep automatic illustration motion out of the evidence view.

Mobile behavior was not tested. Recommended:
- Collapse the workspace to one column below about 900px.
- Put the proposal directly after its associated schedule.
- Stack metrics where necessary.
- Preserve table scrolling without letting the whole page overflow.
- Keep readable labels and adequate touch targets.

## 11. Starter CSS tokens

These combine measured colors/fonts with recommended app dimensions.

```css
:root {
  /* Measured reference colors */
  --canvas: #fffffc;
  --ink: #1e1e1e;
  --muted: #6b6b6b;
  --brand-lime: #bdd13a;
  --manufacturing-orange: #ff4400;
  --active-blue: #0026ff;
  --tag-gray: #d7d7d7;

  /* Recommended application tokens */
  --surface: #fffefb;
  --border: rgba(30, 30, 30, 0.12);
  --subtle: rgba(30, 30, 30, 0.04);
  --danger: #b42318;
  --danger-bg: #fef3f2;
  --success: #166534;
  --success-bg: #f0fdf4;
  --radius-control: 8px;
  --radius-panel: 16px;
  --shadow-panel: 0 20px 48px rgba(30, 30, 30, 0.12);
  --font-ui: "Inter", "Helvetica Neue", Arial, sans-serif;
  --font-data: "IBM Plex Mono", "Courier New", monospace;
}

body {
  background: var(--canvas);
  color: var(--ink);
  font-family: var(--font-ui);
}

.page-title {
  font-size: clamp(2rem, 3.6vw, 2.75rem);
  font-weight: 300;
  line-height: 1.08;
  letter-spacing: -0.02em;
}

.eyebrow {
  color: var(--muted);
  font: 400 0.75rem/1.5 var(--font-data);
  text-transform: uppercase;
  letter-spacing: 0.2em;
}

.panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-panel);
  padding: 24px;
}

.button-primary {
  min-height: 44px;
  padding: 10px 18px;
  background: var(--ink);
  color: var(--canvas);
  border: 1px solid var(--ink);
  border-radius: var(--radius-control);
  font: 500 0.875rem/1.4 var(--font-ui);
}

:focus-visible {
  outline: 2px solid var(--active-blue);
  outline-offset: 3px;
}
```

## 12. Implementation brief for a coding assistant

Build an independently branded manufacturing demo inspired by Evos's public website. Use the measured warm-white/charcoal palette, Inter interface typography, IBM Plex Mono labels and data, fine dividers, modest rounded corners, dark primary buttons, compact neutral badges, and restrained electric-blue operational accents.

Use one readable workspace with a schedule, an operator proposal card, and expandable evidence. Preserve clear status transitions and make backend results authoritative. Keep the interface light, spacious and operational. Use original demo copy and synthetic data. Identify the project as an independent work sample.

Avoid a dark admin theme, purple gradients, oversized pill buttons, excessive shadows, a dense permanent sidebar, decorative gauges, and stock dashboard cards that do not serve the workflow. Do not reproduce Evos's logo or imply this is their official product.

## 13. Visual review checklist

- Warm-white page background, charcoal typography.
- Light page headline; compact mono context labels.
- Primary action is dark, not lime or orange.
- Status colors have text labels.
- Table and chart numbers align consistently.
- One main action per operational state.
- Evidence remains readable without hovering.
- Keyboard focus is visible.
- Loading and blocked states cannot resemble success.
- Mobile layout and color contrast are tested during implementation.
- Simulation label and independent-project identity are present.
- No claim that this document describes the authenticated Evos application.
