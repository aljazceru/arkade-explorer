# Changelog

All notable changes to Arkade Explorer will be documented in this file.

## Unreleased

### Changed

- Refresh direct registry dependencies to current stable releases, including React 19.3,
  Vite 8, TypeScript 7, Vitest 5, Framer Motion 14, and Arkade SDK 0.4.79; pin exact versions.
- Align local, CI, and container tooling on Node 24.22.0 and pnpm 10.34.7, retaining the
  supported toolchain majors and Node 24 type definitions.
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

- Independent number validation: `scripts/validate-numbers.ts` oracle recomputing all Overview
  figures from raw snapshots with optional live upstream reconciliation, plus 19 unit tests for
  the record/status builders (8 files / 79 tests total); Second-scope stats now compute from
  live barkd data when connected and show honest placeholders with a connect hint otherwise,
  replacing the blanket "Not indexed" row.

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
