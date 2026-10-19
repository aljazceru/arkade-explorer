# Arkade Explorer

A modern blockchain explorer for the Arkade protocol, built with React and TypeScript.

## Features

- **Transaction Views**: Browse virtual and commitment transactions with decoded inputs/outputs
- **Address Explorer**: View VTXOs, balances, and assets associated with an Arkade address
- **Asset Browser**: Inspect individual asset details and metadata
- **Batch & Tree Visualization**: Explore batched VTXOs and connector trees
- **Real-time Activity**: Live stream of recent Arkade transactions
- **Theming**: Light (Dawn) and Dark (Midnight) themes

### Expiry monitoring (ark.observer additions)

This fork ([aljazceru/arkade-explorer](https://github.com/aljazceru/arkade-explorer)) adds VTXO expiry
monitoring on top of the upstream explorer by [ArkLabsHQ](https://github.com/ArkLabsHQ/arkade-explorer):

- **Expiry countdown** on every VTXO row (table, cards and dense rows): blocks left and estimated
  wall-clock time until batch expiry. Only active VTXOs get a countdown; settled/spent ones keep
  their label. Blocks are estimated at 10 min/block when the server reports a timestamp.
- **URGENT "needs exit" flag**: `unilateralExitDelay` is read from the operator's `/v1/info`. A VTXO
  whose remaining lifetime is at or below that delay is flagged in red: renew it (settle) or exit
  on-chain now. Values ≥ 512 are treated as seconds and smaller values as blocks (BIP68 convention).
- **Network health panel** on the home page: version, signer pubkey, network, exit delays, VTXO and
  boarding limits, dust, fees, deprecated signers — all straight from `/v1/info`.
- **Watchlist** (`/watchlist`): add script pubkeys (hex) or Arkade addresses; they are kept in
  `localStorage` and listed with their nearest expiry. No notifications yet.

Observation snapshots: run `python3 scripts/observation-indexer.py` to refresh `public/observation/{arkade,bark,summary}.json` from live mainnet APIs (Arkade indexer, Blockonomics archive, captaind gRPC-web, mempool.space).

Sub-path deploys: build with `VITE_BASE_PATH=/ark/ pnpm build` (default base stays `/`).
- **Responsive**: Fully responsive layout for mobile and desktop

## Tech Stack

- **React 19** with TypeScript
- **Vite** for development and builds
- **React Router** for client-side routing
- **TanStack Query** for data fetching and caching
- **Tailwind CSS v4** for styling
- **Radix UI** primitives (dialog, select)
- **Lucide React** for icons
- **@arkade-os/sdk** for Arkade indexer API integration
- **@scure/btc-signer** for transaction decoding

## Getting Started

### Prerequisites

- Node.js 24.22.0 (see `.nvmrc`; supported major: 24)
- pnpm (this project is pnpm-only; pinned to `pnpm@10.34.7`)

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
│   ├── nav/               # Top nav bar and footer
│   ├── shared/            # Reusable components (search, badges, lists, etc.)
│   └── dynamic-layout.tsx # Layout wrapper with nav + footer
├── hooks/                 # Custom React hooks
├── lib/
│   ├── api/               # Indexer API client
│   ├── arkAddress.ts      # Arkade address construction from scripts
│   ├── decode.ts          # Transaction decoding utilities
│   ├── formatters.ts      # Number/date formatting
│   └── utils.ts           # General utilities
├── pages/
│   ├── home.tsx           # Home page with search + activity stream
│   ├── tx.tsx             # Virtual transaction detail
│   ├── commitment-tx.tsx  # Commitment (on-chain) transaction detail
│   ├── address.tsx        # Address VTXOs and balances
│   └── asset.tsx          # Asset detail page
├── providers/             # React context providers
├── themes/                # Dawn (light) and Midnight (dark) CSS themes
└── App.tsx                # Route definitions
```

## Routes

| Path | Description |
|---|---|
| `/` | Home — search and recent activity |
| `/tx/:txid` | Virtual transaction detail |
| `/commitment-tx/:txid` | Commitment transaction detail |
| `/address/:address` | Address VTXOs, balances, and assets |
| `/asset/:assetId` | Asset detail |
| `/watchlist` | Local watchlist of script pubkeys with nearest expiry |
| `/observe` | Side-by-side Arkade vs Second (bark) mainnet observation |

## Overview UI

The home route is **live-first** and implementation-independent:

- **Operator**: bundled default (`arkade.computer`) so the site works out of the box; any Ark
  implementation endpoint can be swapped in via `VITE_INDEXER_URL`. `/v1/info` parameters load
  live from it.
- **Records**: Arkade-scope VTXOs are fetched live from the operator indexer for the scripts on
  your watchlist (operators publish no global browser-facing listing); Second shows live
  on-chain server activity (Esplora) and live gRPC-web server info; barkd-connected wallets add
  their own live VTXOs. The `/observe` page keeps the archived snapshot comparison.
- **Inspector**: expiry versus the operator's live exit window with the live chain tip,
  copyable IDs, source-appropriate wording, and layer-aware links.
- **Sources** section states where each number comes from and what it cannot prove, with a live
  next-Second-round countdown.

### Second: connect your barkd
Second publishes no public VTXO index, so Second records default to observed on-chain server
activity. If you run [barkd](https://second.tech/docs/barkd/index.md) (Second's wallet daemon),
the Overview's connect panel links the explorer to it directly: base URL plus auth token, stored
only in this browser's `localStorage`, calling read-only endpoints (`/wallet/vtxos`,
`/bitcoin/tip`, `/wallet/next-round-time`). While connected, the Second scope lists **your live
wallet VTXOs** — amount, policy, exit delta/depth, chain anchor — with expiry computed from the
reported tip height (`expiry_height − tip`, 10 min/block estimate), never from a stored countdown.
The explorer never sends payments and never sees your seed.

Validate displayed numbers independently: `node scripts/validate-numbers.ts` recomputes
snapshot-derived figures (add `--indexer <url> --esplora <url>` or `ARK_OBS_INDEXER` for live
reconciliation; no endpoints are bundled). Requires the pinned Node 24.

Snapshot-derived figures are point-in-time and labeled as such; unknown expiry is never rendered
as safe. The former home live-activity feed and its SSE provider were removed with this redesign.

## UX design studies

`/ux-options/` keeps the three interactive HTML studies (A, B, C) and the comparison page used to
select the direction; B is now implemented as the production UI above. Study data is illustrative
and no study connects to a wallet.

See [CODEBASE_REVIEW.md](CODEBASE_REVIEW.md) for review findings, dependency decisions, and
verification scope — including implementation verification of the Overview UI. Direct registry
dependencies use exact stable pins; Node types remain on the supported Node 24 major, and exit UI
follows its GitHub Release rather than npm.

## License

MIT. Originally built by [ArkLabsHQ](https://github.com/ArkLabsHQ/arkade-explorer); this fork keeps
the upstream license and attribution.
