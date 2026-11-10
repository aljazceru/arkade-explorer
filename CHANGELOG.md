# Changelog

All notable changes to Arkade Explorer will be documented in this file.

## Unreleased

### Added

- Add the supplied Plausible analytics script and initialization to the application entrypoint.

### Fixed

- Improve Atlas readability with larger supporting labels, natural-width numeric text, and
  clearer panel headings. Rebalance ink/day surfaces and semantic accents; all 70 text/surface
  token combinations per theme exceed WCAG AA's 4.5:1 normal-text threshold. Input, focus, and
  strong-line tokens exceed 3:1 against the five checked control surfaces. These contrast checks
  are not a claim of full WCAG conformance.
  Desktop/mobile browser checks in both themes found no failing visible-text combinations.
  The overview uses at least 12px supporting text, a horizontally scrollable chart that preserves
  label size, a wider Operators column, and two-column exit summaries without stretched panels.

- Refine the Atlas diamond-and-rail favicon for small sizes, with matching SVG, 64px PNG,
  and multi-resolution ICO assets.

- Snapshot VTXO expiry is recomputed from each output's absolute `expiresAt` instead of the
  snapshot's frozen countdown, so outputs that already expired no longer show time left.
- Spent or settled outputs are never counted as needing review (previously inflated the count
  and the value at risk).
- Batch amounts distinguish registered off-chain receivers and forfeited VTXOs from Bitcoin
  inputs, outputs and fees. Forfeits are not fabricated commitment transaction inputs.
- Coin stats no longer label snapshot-derived figures as live.
- The Second scope watches the P2TR address derived from its advertised server key
  (`VITE_SECOND_SERVER_P2TR` overrides). This is not complete round or network activity.
- Snapshot VTXOs the indexer lists more than once render as a single row (spent state wins);
  duplicates previously left stale rows behind when switching the network filter.
- Address pages no longer drop the last page of VTXOs. Paging stopped as soon as a page came
  back shorter than the requested size, but the indexer caps pages at 100 items whatever size is
  asked for, so a 1,537-VTXO address listed 1,500. Paging now follows the indexer's
  `current`/`next`/`total` page metadata (`src/lib/api/fetchAllPages.ts`).
- Expanding a batch on a commitment page loads its tree and VTXOs again (the batch was looked up
  by a bare output index instead of its outpoint), and batch expiry reads the indexer's
  unix-seconds value.
- Watchlist expiry for block-height VTXOs is evaluated against the live chain tip instead of
  being dropped.
- Past Second round announcements remain past; no future rounds are invented from the nominal
  interval. Unconfirmed transactions are not plotted at a moving “now”.
- Arkade historical coverage and stale/missing snapshots are visible. `OBSERVATION_OUT` lets
  local dev/preview use fresh collector output without changing committed regression fixtures.
- Height-based expiry requires a chain tip; unknown evidence stays unknown. “Exit started”
  does not claim an unrolled VTXO has completed or confirmed its unilateral exit.
- Address pagination preserves partial results on failure, exposes retry, deduplicates
  outpoints, and separates received output value from unspent value.
- Asset balances and supply preserve integer precision; issuance group IDs use little-endian
  encoding. Malformed metadata is normalized and invalid decimals show explicit raw units.
  Asset details refresh periodically rather than retaining potentially lossy supply forever.
- Unknown ancestry makes exit depth unknown. Settlement leaf loading drains all pages.
- Stream events are transaction observations, not invented coins or confirmation evidence;
  observed Bitcoin confirmation takes precedence over an unconfirmed notification.
- barkd round timing uses the documented `/api/v1/wallet/next-round` response. Remote tokens
  require HTTPS; HTTP is limited to loopback.
- Removed guessed lifetime/safe-exit guarantees, unlabeled UTC assumptions and broken Bitcoin
  address links into Arkade address lookup. Source refresh failures remain visible with cached data.

### Changed (landing page)

- Restructure the landing page into a visitor-facing network overview: hero with search; Network
  KPIs (liquidity, 24h transactions with sparkline, 24h volume, next Second round) labeled with
  snapshot age; Arkade and Second operator parameter cards; Latest activity table with relative
  time, newest-first order, and plain-English types; Your coins panel limited to watchlist and
  barkd VTXOs; Sources folded into a collapsed "About this data" disclosure without env var names.
- Move the barkd connect panel from the landing page to `/watchlist`.
- Latest activity: the All networks / Arkade / Second filter sits in the table toolbar next to
  the type filters, with a row count per network.

### Changed

- Implement the 03 Atlas redesign as the production UI, replacing the Operator Console. Atlas
  ink (dark, default) and Atlas day (light) themes; Instrument Sans and Martian Mono bundled
  (SIL OFL 1.1); top bar with network pill, search palette (`/`, Ctrl/Cmd+K), sats/BTC toggle
  (sats by default), glyph legend, Observe and Watchlist. The overview is built around the Ark
  layer canvas — Arkade virtual transactions and commitments and Second server transactions over
  a Bitcoin block rail, with time window, lane filter, pan and an inspector — plus an exit
  outlook, operator lifetime-versus-exit-window bars, a latest list, and the activity table with
  a drawer inspector. Transaction pages draw the unroll path down to the on-chain anchor with
  exit depth; commitment pages stand the commitment on its block with its outputs, connectors
  and forfeits; address pages cluster VTXOs by commitment and lead with facts and a needs-action
  callout. One VTXO state vocabulary throughout: "Settled" is an unspent batch VTXO, and a VTXO
  consumed by a commitment reads "Spent in batch". Routes load as separate chunks.
- Refresh direct registry dependencies to current stable releases, including React 19.3,
  Vite 8, TypeScript 7, Vitest 5, Framer Motion 14, and Arkade SDK 0.5.4; pin exact versions.
- Align local, CI, and container tooling on Node 24.22.2 and pnpm 10.34.9, retaining the
  supported toolchain majors and Node 24 type definitions.
- Migrate SDK consumers to `OperatorInfo`, `RestOperatorProvider`, and canonical VTXO
  state/expiry fields. Remove obsolete `virtualStatus` compatibility paths and tests.
- Remove eight unused direct dependencies: Radix select/separator/slot/tabs,
  class-variance-authority, tailwindcss-animate, autoprefixer, and standalone PostCSS.
  Tailwind's PostCSS plugin owns its PostCSS dependency. Keep Node typings on the Node 24 line.
- Include the upstream OFL copyright and license notices for all bundled font families.
- Update CI and Docker actions to their current stable releases, pinned by commit SHA.
  CI reads the pnpm version from `packageManager` instead of repeating it in the workflow.
- Use native ESM directory resolution in Vite and Vitest configuration.
- Implement the selected Operator Console design as the production UI: wide workspace chrome
  with brand mark and network pill; Overview home with snapshot-labeled stats, filterable and
  searchable transaction table, and a record inspector (desktop side panel, responsive dialog)
  with expiry-versus-exit-window meter, copyable IDs, and layer-aware links; Sources section
  with live operator status and snapshot ages. Removes the home activity feed and its SSE
  provider.

### Added

- Second "connect your barkd" mode: local-only barkd connection (URL + token in localStorage,
  read-only REST endpoints) that replaces Second snapshot rows with the user's live wallet VTXOs,
  computes expiry from the reported chain tip, and enriches the inspector with policy, exit
  delta/depth, and chain-anchor links; adds a next-Second-round countdown and Copy JSON to the
  detail panel. Second's mempool.second.tech Esplora has no human UI, so on-chain links stay on
  mempool.space.

- Snapshot number diagnostics: `scripts/validate-numbers.ts` recomputes sampled expiry/status
  figures with optional live upstream reconciliation. This is not proof of complete network
  totals, consensus validity, wallet spendability or exit safety.

- Three high-fidelity redesign proposals at `/redesign/` — 01 Signal (dark keyboard-first
  console), 02 Datasheet (light print-grade reference with generated readings), 03 Atlas
  (spatial map with unroll path and exit depth) — each covering overview, virtual transaction,
  commitment and address views, plus a comparison page with screenshots and a recommendation.
  All three read one real mainnet capture (`public/redesign/data.js`) on a frozen clock and
  make no network requests; fonts are vendored under SIL OFL 1.1. 03 Atlas was selected and is
  implemented as the production UI (see Changed).

### Changed (cont.)

- Rebrand as ark.observer with marketing neutrality across both observed networks: no vendor
  CTAs, attribution, or Arkade promotion; bundled default operator (arkade.computer) so the
  service works out of the box, swappable via VITE_INDEXER_URL; vendor-free
  scripts/middleware/validator (ARK_OBS_* env/flags); neutral chrome, titles, and OG cards.
  Overview is live-first: watchlist-script VTXOs from the operator indexer, live Second
  gRPC-web info plus Esplora on-chain server activity, live chain tip and exit window;
  committed snapshots remain only on /observe. Deployed to https://ungovernable.exe.xyz/ark/.

- Three standalone, interactive HTML UX proposals and a comparison page at `/ux-options/`;
- Codebase review documenting expiry-state, stale-snapshot, metadata, integer-precision,
  stored-state, mobile-layout, and transaction-navigation risks.

## [1.0.0] - 2025-11-24

### Added
- Initial release of Arkade Explorer
- Transaction explorer for commitment and Arkade transactions
- Address explorer with VTXO list and statistics
- Smart search functionality (auto-detect txid vs address)
- Retro Space Invaders theme with purple, orange, gray, and black colors
- Responsive design with TailwindCSS v4
- React Router for client-side navigation
- TanStack Query for data fetching and caching
- Reusable UI components (Card, Badge, CopyButton, etc.)
- Loading states and error handling
- Copy-to-clipboard functionality
- Transaction hex viewer
- VTXO tree viewer component
- Pagination component
- Tooltip and Tabs components
- Bitcoin transaction decoding utilities
- Input validation and sanitization
- Multiple formatters for amounts, timestamps, and hashes
- Environment variable support for indexer URL
- Hot module replacement (HMR) for development
- Production build optimization
- Deployment configurations for Vercel and Netlify
- Comprehensive documentation (README, DEPLOYMENT, CONTRIBUTING, FEATURES)
- TypeScript support with strict mode
- ESLint configuration
- Custom favicon
- 404 Not Found page

### Technical Details
- React 18.2.0
- TypeScript 5.2.2
- Vite 5.1.0
- TailwindCSS 4.1.17
- React Router 7.9.6
- TanStack Query 5.90.10
- @scure/btc-signer 2.0.1
- @scure/base 2.0.0

### Performance
- Bundle size: 261 KB (gzipped: 82 KB)
- CSS size: 16 KB (gzipped: 4 KB)
- Build time: ~5-6 seconds

### Routes
- `/` - Home page
- `/tx/:txid` - Transaction view (auto-redirects)
- `/commitment-tx/:txid` - Commitment transaction details
- `/address/:address` - Address VTXO list
- `/*` - 404 page

[1.0.0]: https://github.com/arkade-os/arkade-explorer/releases/tag/v1.0.0
