# Codebase review and UX directions

Reviewed 2026-10-19. Scope: application routes, data/cache boundaries, expiry interpretation,
observation snapshots, local persistence, deployment middleware, dependencies, and browser UX.
This is a targeted review, not a formal security audit. Findings below remain **unfixed**:
this change upgrades dependencies and supplies design alternatives, not a production UX rewrite.

## Findings, ordered by risk

### High — Unknown expiry can appear as “no active VTXOs”

- `src/pages/watchlist.tsx:61-69,101-105` computes active funds separately from expiry, calls
  `remainingLifetime(v, now)` without a tip height, and equates missing expiry with an empty wallet.
- `src/lib/vtxo-display.ts:99-108` returns `null` for height-based expiry without a tip, even if
  the VTXO is active and near expiry. A failed query also reaches the empty-expiry wording.
- Runtime helper reproduction: `{ expiresAtHeight: 1001 }` without a tip returns `null`;
  with tip `1000`, it returns one block / 600 estimated seconds remaining.
- **Impact:** no urgency flag for active height-expiry funds; contradictory count/balance and
  reassuring expiry text. This helper reproduction does not establish that current mainnet
  returns height-based expiries.
- **Fix:** supply the chain tip, then distinguish loading, error, no funds, unknown expiry,
  and known expiry. Reuse the existing expiry-countdown component's tip-aware convention.

### High — Observation warnings do not age with the snapshot

- `scripts/observation-indexer.py:157-178` stores relative lifetime and urgency flags.
- `src/components/shared/observation-dashboard.tsx:55,97,126-159,378-401` renders those stored
  values unchanged, calls the rows “Live VTXOs,” and loads on mount/manual reload only.
- Browser observation confirmed the page describes “live public data” while displaying an
  older snapshot. The frozen lifetime behavior is established from source, not a timed
  before/after browser experiment.
- **Impact:** a deadline or urgency threshold can pass without the warning changing. Reloading
  cannot repair a stale indexing job's stored relative values.
- **Fix:** derive remaining lifetime from absolute expiry/current clock and tip; expose snapshot
  age and stale/unavailable status. Never describe a snapshot as a continuous monitor.

### High — Malformed asset metadata can blank the application

- `src/hooks/use-asset-details.ts:7-13,35-44` trusts cached JSON and fetched metadata.
- `src/components/shared/asset-detail.tsx:83` assumes ticker has a string `charAt` method.
- **Browser reproduction:** a session-cache fixture with `metadata: { ticker: 123 }` on an
  asset route produced `TypeError: metadata?.ticker?.charAt is not a function` and an empty
  page. The fixture was removed after reproduction.
- `src/lib/api/indexer.ts:55-60` also uses unbounded metadata decimals in `padStart`.
  The middleware has a similar formatting boundary (`functions/_middleware.js:185-192`).
  Oversized-decimal resource exhaustion was not exercised.
- **Fix:** validate cached and fetched data at one boundary; bound decimals and validate known
  metadata field types. Contain invalid metadata so an asset cannot take down the entire view.
  Whether the upstream SDK/server rejects invalid network metadata was not established.

### Medium — Asset quantities lose integer precision before formatting

- `src/hooks/use-asset-details.ts:42` converts bigint supply to `Number` before caching.
- `src/components/shared/transaction-detail.tsx:470,638,962,998` similarly converts asset
  packet quantities before display.
- **Runtime reproduction:** `9007199254740993n` formats correctly as
  `9,007,199,254,740,993`, but the same value after the supply-boundary `Number(...)`
  conversion displays `9,007,199,254,740,992`.
- **Fix:** preserve bigint for asset arithmetic/rendering; serialize decimal strings at the
  JSON cache boundary and validate/restore them on read. Do not apply this indiscriminately
  to Bitcoin satoshi values, whose total supply is within the safe integer range.

### Medium — Malformed stored search state can break rendering

- `src/hooks/use-recent-searches.ts:22-31` assigns any successfully parsed JSON to array state.
- Subsequent `.filter` / `.some` calls assume an array; address and transaction rendering
  call `isPinned` (`src/pages/address.tsx:189`,
  `src/components/shared/transaction-detail.tsx:1030`).
- **Source-confirmed scenario:** stored `{}` or `null` is valid JSON but not a valid pinned
  search array. The parse-time catch cannot contain a later render error. Not reproduced
  in the browser during this review; this is not a cross-origin storage-write claim.
- **Fix:** validate array shape and entries on load; safely discard malformed stored state.

### Medium — Virtual outpoints navigate to the wrong transaction layer

- `src/components/shared/observation-dashboard.tsx:133-142` sends all observed VTXO IDs to
  `mempool.space/tx`, although virtual IDs belong to the Arkade indexer. Commitment IDs
  already have their own separate on-chain links.
- Browser DOM inspection confirmed an observed outpoint points to mempool.space.
  The external destination's response was not exercised.
- **Impact:** virtual transaction investigation can lead to an irrelevant on-chain
  “not found” result.
- **Fix:** link virtual transactions to `/tx/:txid`; reserve external Bitcoin explorer links
  for commitments and actual on-chain transactions.

### Medium — Observation layout overflows a narrow viewport

- **Browser reproduction:** at a 390px viewport, the current `/observe` document had a
  518px scroll width. The screenshot showed cards and network fields clipped on the right.
- **Fix:** use shrinkable grid children, wrap endpoint/source text, and constrain tables
  to their own scroll containers. Retain explicit navigation labels on mobile.

### Medium — Eager route loading adds a large initial JavaScript payload

- The production build emitted one main JavaScript chunk of **1,641.89 kB minified /
  485.10 kB gzip**, with Vite's large-chunk warning.
- `src/App.tsx:4-12` eagerly imports every route, including the specialized exit flow.
  Bundle composition and load-time impact were not profiled; this is not a measured
  regression against the previous dependency set.
- **Fix:** evaluate route-level lazy loading first, then measure startup and navigation
  on a throttled mobile connection. Keep the warning rather than raising its threshold.

## Architecture assessment

The existing SDK transport boundary, TanStack Query hooks, pagination helper, and pure expiry
helpers are useful foundations. Keep them rather than adding a second data layer for a redesign.
The main risk is semantic drift: observation has its own snapshot/expiry interpretation while
watchlist and VTXO views use different evidence and fallbacks. Unify state meaning before
implementing new visual treatment.

## Dependency refresh

All registry-backed direct packages were checked against their current stable release tags.
Dependencies are now exact pins, with a refreshed lockfile. Notable changes:

| Package                   | Before   | After   |
| ------------------------- | -------- | ------- |
| `@arkade-os/sdk`          | 0.4.78   | 0.4.79  |
| React / React DOM         | ^19.0.0  | 19.3.1  |
| React Router DOM          | ^7.9.6   | 7.18.4  |
| TanStack React Query      | ^5.90.10 | 5.104.4 |
| Framer Motion             | ^12.0.0  | 14.4.0  |
| Lucide React              | ^0.554.0 | 1.59.0  |
| Vite                      | ^6.3.5   | 8.3.4   |
| Vite React plugin         | ^4.5.2   | 6.1.2   |
| TypeScript                | ^5.7.0   | 7.0.2   |
| Vitest                    | ^4.1.9   | 5.0.5   |
| Tailwind / PostCSS plugin | ^4.1.17  | 4.3.3   |
| Prettier                  | 3.6.2    | 3.9.10  |

Toolchain: latest Node 24 LTS-line release found, **24.22.0**, and latest pnpm 10 release found,
**10.34.7**. Local pin, engine ranges, CI, and Docker build references are aligned. We retain
these supported majors rather than switching this repository to Node 26 or pnpm 11.
`@types/node` is deliberately **24.19.2**, not latest-major 26.6.5, to match the runtime.

`@arkade-os/exit-ui` remains **0.2.0**: it is already the newest published GitHub release,
not a registry package. No new tarball was adopted, so there is no new release/CI gate to certify.
The existing Tailwind source directive and semantic token mappings are preserved; the import
screen was visually verified styled after the dependency upgrades. No exit transaction was run.

Evidence sources: [Node release index](https://nodejs.org/dist/index.json),
[exit UI releases](https://github.com/arkade-os/arkade-unilateral-exit/releases),
`pnpm outdated --format json`, and `pnpm audit --json`.
The post-upgrade outdated report lists only the intentional Node type-major difference.
The audit returned zero advisories across all severities; this does not certify the application
or the release-tarball dependency free of vulnerabilities.

## UX proposals

Open [`public/ux-options/index.html`](public/ux-options/index.html) directly, or start the app
and visit `/ux-options/`.

- **A — Clear Explorer:** search first, compact status, expandable operator details, transaction
  layer-aware inspection, explicit stale/error previews. Best general explorer starting point.
- **B — Operator Console (selected):** Arkade-branded dark workspace with a dense transaction
  table, expiry inspector, and responsive list/sheet layouts.
- **C — Safety Desk:** expiry-first monitoring, priority triage, local-only watchlist context.
  Best when recurring fund-health checks are the primary job.

**Chosen direction:** the user selected B and asked for a more polished, less "generated" look.
The current pass uses the real Arkade mark, the app's bundled Geist font, and the brand purple
as the only accent; amber/green/red appear only for status. Prototype-only controls live in a
"Prototype" menu instead of the product surface. Each transaction shows remaining lifetime
against the network's exit window. Counts derive from the selected scope, not invented totals.
The single-page view has no sidebar: brand and network label live in the top bar, and source
freshness sits under the page title. The fourth stat totals the sample value needing review.

All prototypes are standalone HTML/CSS/JavaScript with illustrative data, not new production
features. They do not connect to APIs or wallets and do not alter the real watchlist. Production
React layout and the outstanding findings above are intentionally unchanged pending implementation.

## Verification performed

- `pnpm install --frozen-lockfile`: passed with the refreshed exact pins.
- `pnpm build`: passed using TypeScript 7 and Vite 8; large-chunk warning remains visible.
- `pnpm run typecheck`: passed. TypeScript 7 required explicit Node type inclusion for
  the existing Node-based tests; Buffer is now imported explicitly in its test file.
- `pnpm run lint`: passed.
- `pnpm test`: **7 files / 60 tests passed** after the type migration.
- Browser smoke: home/operator response, search overlay, empty watchlist, observation
  snapshots, and a real indexed virtual transaction decoded with inputs and outputs.
- Production preview smoke: home, search overlay, and the exit import screen. Its textarea
  had a nontransparent mapped background and 8px radius; a screenshot confirmed styling.
- Each HTML option: desktop and 390px mobile visual inspection; no document horizontal
  overflow after fixing the Operator Console's mobile flex cross-axis sizing. Wide tables
  and status strips scroll within their own regions.
- Prototype interactions exercised: fixture searches, record-type/state/network filters,
  empty/reset paths, details and Escape dismissal; stale/error previews in A/B; in-memory
  watch toggle and simulated refresh in C; mobile inspector focus and backdrop dismissal in B.
- All three option files opened directly through `file://` and filtered the Treasury fixture
  using only inline scripts. The comparison page also opened directly.

No funds were moved. No real exit package, browser notifications, full address/asset coverage,
upstream exit-protocol suite, Docker image build, or production deployment was exercised.
The initial shell had Node 22 and no pnpm shim; verification used an isolated Node 24.22.0
runtime with Corepack/pnpm 10.34.7. Normal local development should first select `.nvmrc`
and enable Corepack rather than using that shell's default Node.

### Option B polish

- Visually checked desktop (1440px and 1920px), tablet (820px and the 1024px drawer), and mobile
  list/bottom sheet (390px); no document-level horizontal overflow. Geist loads from `public/fonts`.
- Exercised network and type filters, needs-review filter, search/clear/reset, amount sorting,
  copy ID, prototype source-state menu (Escape returns focus), and Ctrl/⌘K.
- Detail sheets open focused on the close control and return focus to the selected row.
- Stale/unavailable states mark expiry unverified and relabel inspector evidence as last-known.
  The page contains no audio, video, or embedded frames; checks ran in a muted browser.

### Production implementation of the Overview UI

Implemented via two parallel tracks (app chrome; overview page and components) plus one corrective
pass (row selection), then verified by the orchestrator:

- Gates after the union of changes: `typecheck`, `lint`, `test` (**7 files / 60 tests**), and
  `build` all pass; only the pre-existing large-chunk warning remains.
- Production build served and exercised in a muted headless browser: top bar with network pill
  (resolves from `/v1/info`), Cmd+K palette, snapshot-age-labeled stats, and the 62-record table
  (13 virtual, 49 commitments/on-chain) built from the committed observation snapshots.
- Interactions: network scope (All 62 / Arkade 19 / Second 40), type tabs, needs-review filter
  (3 rows), search (fixture txid → 1 row), ascending/descending amount sort.
- Row selection opens the inspector without navigating on desktop; at 390px it opens a modal
  bottom sheet that blocks background interaction, closes on Escape, and returns focus.
  Inspector links verified layer-aware: Arkade virtual → `/tx/:txid`, commitment →
  `/commitment-tx/:txid`, Second on-chain → `mempool.space` with `target=_blank` and
  `rel="noopener noreferrer"`.
- Theme toggle renders both themes; `/watchlist`, `/observe`, and `/tx/:txid` render under the
  new chrome; zero console/page errors across the session.
- Removed with the redesign: home activity feed and `activity-stream-provider` (home was its only
  consumer). No funds-related actions exist on the page.

### barkd connect implementation

Three parallel tracks (foundation client/hook/panel; home+table integration; detail/sources
enrichment) plus two corrective passes (shared hook state; live-record link semantics), verified
by the orchestrator:

- Gates after the union: `typecheck`, `lint`, `test` (7 files / 60 tests), `build` — all pass.
- End-to-end against a local mock barkd (CORS + bearer, real field shapes): wrong token shows
  an inline unauthorized error; correct token connects and reports the tip height
  (`GET /api/v1/bitcoin/tip` → `{tip_height}`); the connection persists across reloads.
- Live Second scope lists wallet VTXOs with correct derived statuses — 500 blocks left →
  "3d 11h left" (healthy), 10 blocks → "1h 40m left" (urgent, inside the 144-block exit
  window), locked, and spent→settled; the needs-review chip counts only the urgent row.
- Inspector shows Policy, Exit delta (144 blocks · ~1d 0h), Exit depth, Chain anchor with an
  external mempool.space link, Copy JSON with confirmation, and live-source wording. Live
  virtual records no longer offer an "Open transaction" link to their off-chain txid — the
  layer confusion called out in the review findings.
- Sources section shows "barkd connected · live VTXOs" and a next-round countdown
  ("in ~44m · 19:02 UTC"); the 390px bottom sheet renders the enriched detail; Arkade scope
  and links unchanged; disconnect restores snapshot on-chain rows; zero page errors.
- `https://mempool.second.tech` exposes `/api` only (404 on `/` and `/tx/:txid`), so human
  on-chain links stay on mempool.space. The mock barkd ran with a throwaway token; no real
  wallet was connected and no funds were moved.

### Number validation (independent oracle)

Every figure the Overview displays is now verifiable against sources that do not share the
app's code:

- **`scripts/validate-numbers.ts`** (run with the pinned Node 24; `--live --sample N` for
  upstream reconciliation, `--json` for machine output) independently recomputes per-row
  statuses, review counts, nearest expiry, value-at-risk, record counts, and the barkd
  tip-based policy (including a worked boundary example: `expiry − tip` of exactly the exit
  window is urgent, one block more is healthy).
- **`src/components/overview/records-table.test.ts`** (19 tests) pins the pure builders with
  hand-computed fixtures plus real-snapshot structural invariants and monotonicity properties
  (urgency flips at the threshold; terminal beats urgent/expired).
- **Live reconciliation against upstream** (`--live`): Arkade `/v1/info` exit delay,
  per-outpoint indexer amounts/expiry/spent flags, and mempool.space commitment heights and
  output sums all matched the snapshot. The only WARN is the snapshot's Second next-round time
  having passed — correct behavior for a hours-old snapshot, now graded as staleness, not
  failure.
- **DOM-vs-oracle, muted browser**: rendered stats equaled the oracle exactly — Arkade/all:
  review 3, nearest 3d 21h, 19 transactions (10 virtual · 9 on-chain), value 113,172 sats;
  row statuses spot-checked (549- and 112,074-sat rows urgent at 3d 21h; four settled); with
  mock barkd (tip 905000): review 1, nearest 1h 40m, 3 wallet VTXOs, value 47,210 sats;
  disconnected Second shows three honest "—" cards with a connect hint and the real 40
  on-chain server transactions. The misleading blanket "Not indexed" placeholders are gone.
  Zero page errors. Suite totals after this pass: **8 files / 79 tests**.

### ark.observer neutrality + live-first verification

- Three parallel tracks (operator configuration, de-brand, neutral scripts) plus the live-data
  wave (live Overview records/stats, live Second client) and two corrective passes; gates green
  after each union: typecheck, lint, **8 files / 79 tests**, build.
- Deployed to `https://ungovernable.exe.xyz/ark/` (rsync over the VM's `ark-site`, observation
  directory preserved) and verified from the real origin in a muted browser:
- Fresh load shows no bundled operator — Operator panel plus footer "No operator configured",
  and no request to any vendor host. Runtime entry of an operator connects, reloads, and the
  network pill resolves (`Mainnet`) from live `/v1/info`.
- Live data verified end-to-end: a watchlist script fetched **1,060 live Arkade VTXOs** from
  the operator indexer cross-origin (statuses live: urgent at 1d 23h flagged for review,
  healthy at 29d 23h); Second listed **40 live on-chain server transactions** via Esplora with
  live gRPC-web server info and countdown. Zero page errors. Record detail wording is
  source-appropriate (operator indexer / barkd / on-chain).
- Endpoint findings recorded for posterity: the operator's SSE `/v1/txs` is unusable from any
  origin tested (localhost, ark.observer deployed origin — EventSource closes with no events),
  and no REST listing exists (all candidates 404); the indexer requires scripts/outpoints
  filters. Live watchlist + barkd + Esplora + gRPC-web are the viable browser-live surface.
  Blockonomics remains server-side-only (no CORS). Snapshots stay only as the `/observe`
  archive.
