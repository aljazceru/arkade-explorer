# Arkade Explorer

A modern blockchain explorer for the Arkade protocol, built with React and TypeScript.

## Features

- **Transaction Views**: Browse virtual and commitment transactions with decoded inputs/outputs
- **Address Explorer**: View VTXOs, balances, and assets associated with an Arkade address
- **Asset Browser**: Inspect metadata and exact integer supply/amounts without floating-point
  truncation. Asset details refresh every minute; obsolete persisted caches are not reused.
- **Batch & Tree Visualization**: Explore batched VTXOs and connector trees
- **Activity observation**: New Arkade stream events plus sampled historical backfill; Second's
  public server-key address transactions are observed separately
- **Theming**: Atlas ink (dark, default) and Atlas day (light) themes
- **Responsive**: Mobile and desktop layouts

### Expiry monitoring (ark.observer additions)

This fork ([aljazceru/arkade-explorer](https://github.com/aljazceru/arkade-explorer)) adds VTXO expiry
monitoring on top of the upstream explorer by [ArkLabsHQ](https://github.com/ArkLabsHQ/arkade-explorer):

- **Expiry countdown**: remaining time from the indexer's expiry timestamp, or remaining blocks
  from its expiry height and the current chain tip. Block-to-time conversions use a nominal
  600 seconds per block and are estimates. Missing evidence stays unknown.
- **Renewal warning**: compares remaining lifetime with the operator's reported exit delay.
  This is a warning heuristic, **not a guarantee that an exit can finish**: ancestry depth,
  confirmation timing, fees and available transaction data also matter.
- **Protocol states**: an unspent batch-finalized VTXO is "Settled"; a consumed output is "Spent"
  or "Spent in batch". "Exit started" does not prove a completed on-chain claim. Recovery after
  expiry or a sweep requires operator cooperation.
- **Operator parameters** come from `/v1/info` or explicitly labelled snapshots. The SDK's
  `/v1/info` wire convention interprets raw delays below 512 as blocks and larger values as
  seconds; this is **not** general BIP68 decoding (BIP68 encodes the unit in a type bit).
- **Watchlist** (`/watchlist`): add script pubkeys (hex) or Arkade addresses; they are kept in
  `localStorage` and listed with their nearest expiry. No notifications yet.

Observation history needs a running collector. Bundled `public/observation/*.json` files are
frozen regression fixtures, not a live feed. For development/preview, set `OBSERVATION_OUT` to a
directory populated by `scripts/observation-indexer.py`; Vite serves those files instead without
modifying the fixtures. See [fresh observation deployment](DEPLOYMENT.md#fresh-observation-data)
for required endpoint variables and production refresh instructions. A stale Arkade snapshot can
leave its recent-time-window lane empty while Second's independent live source is populated.

Sub-path deploys: build with `VITE_BASE_PATH=/ark/ pnpm build` (default base stays `/`).

## Tech Stack

- **React 19** with TypeScript
- **Vite** for development and builds
- **React Router** for client-side routing
- **TanStack Query** for data fetching and caching
- **Tailwind CSS v4** for styling
- **Radix UI** primitives (dialog, tooltip)
- **Lucide React** for icons
- **@arkade-os/sdk** for Arkade indexer API integration
- **@scure/btc-signer** for transaction decoding

## Getting Started

### Prerequisites

- Node.js 24.22.2 (see `.nvmrc`; supported major: 24)
- pnpm (this project is pnpm-only; pinned to `pnpm@10.34.9`)

### Installation

```bash
pnpm install
```

### Configuration

Copy `.env.example` to `.env` and adjust as needed:

```env
VITE_INDEXER_URL=https://indexer.arkadeos.com
VITE_VERIFIED_ASSETS_URL=https://arklabshq.github.io/asset-registry/mutinynet.json
```

### Environment Variables

| Variable | Description | Required | Default |
|---|---|---|---|
| `VITE_INDEXER_URL` | Arkade indexer API URL | No | `https://arkade.computer` |
| `VITE_SECOND_SERVER_P2TR` | Second server on-chain address watched for round activity | No | Second's published P2TR |
| `VITE_ARK_URL` | Arkade operator URL (falls back to indexer URL) | No | same as `VITE_INDEXER_URL` |
| `VITE_ARKADE_URL` | Arkade website link | No | `https://arkade.money` |
| `VITE_VERIFIED_ASSETS_URL` | URL to fetch verified asset IDs (JSON array). When set, only verified or user-approved assets show icons. | No | — |

### Development

```bash
pnpm dev
```

The app will be available at `http://localhost:5173` with hot reload.

### Build

```bash
pnpm build
```

### Preview Production Build

```bash
pnpm preview
```

### Docker

Run the pre-built image from GHCR:

```bash
docker run -p 8080:80 ghcr.io/arklabshq/arkade-explorer:latest
```

The app will be available at `http://localhost:8080`.

To build locally:

```bash
docker build -t arkade-explorer .
docker run -p 8080:80 arkade-explorer
```

## Project Structure

```
src/
├── components/
│   ├── atlas/             # Atlas design kit (glyphs, panels, tags, legend) and page views
│   ├── nav/               # Top bar and footer
│   ├── shared/            # Reusable components (search, badges, lists, etc.)
│   └── dynamic-layout.tsx # Layout wrapper with nav + footer
├── hooks/                 # Custom React hooks
├── lib/
│   ├── api/               # Indexer API client and page draining (fetchAllPages)
│   ├── atlas/             # Pure Atlas layout and state logic (canvas lanes, clusters, VTXO state)
│   ├── arkAddress.ts      # Arkade address construction from scripts
│   ├── decode.ts          # Transaction decoding utilities
│   ├── formatters.ts      # Number/date formatting
│   └── utils.ts           # General utilities
├── pages/
│   ├── home.tsx           # Overview: Ark layer canvas, operators, exit outlook, activity
│   ├── tx.tsx             # Virtual transaction detail
│   ├── commitment-tx.tsx  # Commitment (on-chain) transaction detail
│   ├── address.tsx        # Address VTXOs and balances
│   └── asset.tsx          # Asset detail page
├── providers/             # React context providers
├── themes/                # Atlas ink (midnight.css, dark) and Atlas day (dawn.css, light) themes
└── App.tsx                # Route definitions
```

## Routes

| Path | Description |
|---|---|
| `/` | Overview — Ark layer canvas, operators, exit outlook, activity |
| `/tx/:txid` | Virtual transaction detail |
| `/commitment-tx/:txid` | Commitment transaction detail |
| `/address/:address` | Address VTXOs, balances, and assets |
| `/asset/:assetId` | Asset detail |
| `/watchlist` | Local watchlist of script pubkeys with nearest expiry |
| `/observe` | Side-by-side Arkade vs Second (bark) mainnet observation |

## Overview UI

The home route is a network overview for visitors, in the Atlas design: positions mean something
(time runs left to right, Bitcoin blocks along the bottom), and the glyph legend sits in the top
bar. Top to bottom:

- **The Ark layer**: a canvas of the last 6h / 24h / 7d. Arkade virtual transactions (operator live
  stream with snapshot backfill) and commitments sit in their own lanes above the Bitcoin block
  rail they anchor to; Second address transactions have their own lane. Hourly density is shown
  only for archive timestamps with an explicit timezone. A marker may show a future
  server-announced round time; past announcements are not projected forward. Filter lanes, drag
  or shift-scroll to pan, and click a block or event to open it in the inspector.
- **Exit outlook**: sampled unspent VTXOs by expiry, not a network-wide VTXO index. Transaction
  announcements are not coins. Second has no public VTXO index; wallet-specific values require
  barkd. Personal statistics cover only watchlist and barkd results.
- **Operators**: Arkade (live `/v1/info`, labelled snapshot fallback) and Second (live gRPC-web,
  labelled snapshot fallback). Arkade's lifetime bar uses sampled batch lifetimes, not an
  invented 30-day default. Second's configured lifetime is in blocks. Neither bar represents a
  guaranteed safe-exit window.
- **Latest**: the newest events across both networks.
- **Activity**: newest-first table with source-qualified transaction/output types, network and
  entity filters, needs-review toggle and search. Rows open the inspector with amount scope,
  expiry evidence and provenance. Arkade registered batch-receiver amounts are distinct from
  Bitcoin input/output sums; Bitcoin output sums include change and are not payment volume.
  Snapshot countdowns advance from absolute expiry or a dated observation, not frozen flags.
- **About this data** (collapsed): per-source status, coverage limits, and definitions.

The operator is a bundled default (`arkade.computer`) swappable via `VITE_INDEXER_URL`.

### What the data does not prove

- The overview is **sampled**, not a complete index of either implementation. The current
  collector enriches outputs 0–2 of the archive's ten latest Arkade transactions. Its referenced
  commitments are not an exhaustive batch list.
- A Second transaction touching the address derived from its advertised server public key is
  not, by itself, proof of a round, a payment, or network-wide volume. Direction describes the
  address's inputs/outputs; it does not classify the protocol operation.
- Stream receipt is not Bitcoin confirmation. A missing block height is unknown confirmation
  evidence, not proof a transaction is waiting in the mempool.
- Address totals describe the loaded query results. Partial pages are labelled; spent output
  values are historical values, not an available balance. The upstream dataset can change while
  pages are being fetched.
- This explorer trusts the configured indexer, archive and Esplora responses; it is not a Bitcoin
  consensus verifier, wallet backup, deadline alarm, or financial safety certification.


### Second: connect your barkd
Second publishes no public VTXO index, so Second activity defaults to observed on-chain server
transactions. If you run [barkd](https://second.tech/docs/barkd/index.md) (Second's wallet daemon),
the connect panel on `/watchlist` links the explorer to it directly: base URL plus auth token,
stored in this browser's `localStorage`. The integration uses read-only endpoints:
`/api/v1/wallet/vtxos`, `/api/v1/bitcoin/tip` and `/api/v1/wallet/next-round`.
Plain HTTP is accepted only for loopback hosts; remote daemons require HTTPS. Anyone with access
to this browser's storage can read its saved bearer token. While connected, personal coin
statistics include wallet VTXOs, with expiry from the reported tip height and each coin's own
exit delta. These time conversions are approximate.

Browsing and the barkd integration do not move funds. The separate `/unilateral-exit` route
**can broadcast transactions** from an imported pre-signed package through `@arkade-os/exit-ui`.
It persists its session locally; imported packages can contain sensitive condition witnesses.

`node scripts/validate-numbers.ts` performs snapshot and optional live-source reconciliation
(add `--live --indexer <url> --esplora <url>`; requires Node 24). It is an additional diagnostic,
not proof of complete network coverage or a substitute for protocol review and browser checks.
See [the audit record](CODEBASE_REVIEW.md) for dated evidence and verification limits.

## UX design studies

`/ux-options/` keeps the three interactive HTML studies (A, B, C) and the comparison page used to
select the direction; B is now implemented as the production UI above. Study data is illustrative
and no study connects to a wallet.

`/redesign/` holds the next round: three high-fidelity redesign proposals of the whole explorer —
**01 Signal** (dark, keyboard-first console), **02 Datasheet** (light, print-grade reference with
generated plain-language readings) and **03 Atlas** (spatial map of VTXOs, commitments and blocks
with exit depth) — plus `index.html`, which compares them. Each prototype is a single
self-contained HTML file covering the overview, virtual transaction, commitment and address views;
all three read the same real mainnet capture in `public/redesign/data.js` (frozen clock, no network
requests). Fonts under `public/redesign/fonts/` and `src/assets/fonts/` are SIL OFL 1.1;
copyright and license notices are included in `public/fonts/licenses/`. **03 Atlas was
selected and is the production UI**; the prototypes stay as the design reference.

See [CODEBASE_REVIEW.md](CODEBASE_REVIEW.md) for review findings, dependency decisions, and
verification scope — including implementation verification of the Overview UI. Direct registry
dependencies use exact stable pins; Node types remain on the supported Node 24 major, and exit UI
follows its GitHub Release rather than npm.

## License

MIT. Originally built by [ArkLabsHQ](https://github.com/ArkLabsHQ/arkade-explorer); this fork keeps
the upstream license and attribution.
