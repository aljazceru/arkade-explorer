# Deployment Guide

## Environment Variables

Use the pinned Node 24.22.2 and pnpm 10.34.9 toolchain. The default Arkade operator is
`https://arkade.computer`; override it only with a compatible operator/indexer.

```env
VITE_INDEXER_URL=https://arkade.computer
VITE_ESPLORA_URL=https://mempool.space/api
# VITE_BASE_PATH=/ark/
```

## Build for Production

```bash
pnpm build
```

This will create an optimized production build in the `dist` directory.

## Fresh observation data

A static build does **not** start a collector. `public/observation/*.json` are frozen test
fixtures; do not publish them as current network history. Second's live browser requests can
work while Arkade's historical lane remains empty because its snapshot is outside the time
window. Arkade stream events only arrive while the page is listening.

From the repository root, collect real data into a separate directory:

```bash
export ARK_OBS_ARK_URL=https://arkade.computer
export ARK_OBS_ACTIVITY_URL=https://arkexplorer.blockonomics.co
export ARK_OBS_BARK_URL=https://ark.second.tech
export ARK_OBS_MEMPOOL_URL=https://mempool.space/api
export OBSERVATION_OUT=/tmp/ark-observer-observations
python3 scripts/observation-indexer.py
pnpm dev
```

Vite development and preview servers honor `OBSERVATION_OUT` (environment or `.env.local`).
They serve only the three observation JSON files from that directory. A missing configured
file returns HTTP 503 rather than silently substituting an old fixture.
The collector is separate: run it again, or schedule it, to keep this directory current.
The Blockonomics archive does not allow browser cross-origin access; collection is server-side.

For a production static deployment, run collection **after** the build with
`OBSERVATION_OUT` pointing to the deployed `observation` directory, for example:

```bash
pnpm build
OBSERVATION_OUT="$PWD/dist/observation" python3 scripts/observation-indexer.py
```

Keep the endpoint exports above in the collector's environment. Schedule refreshes at least
every 15 minutes and publish the resulting JSON atomically. `scripts/observation-run.sh`
provides a lock and timeout, but its historical VM paths must be overridden with
`OBSERVATION_OUT` and `OBSERVATION_LOG` on another host. On immutable static hosting, a scheduled
job must regenerate and republish the observations; setting a Vite environment variable alone
cannot do that.

Before announcing a deployment:

1. Run `pnpm run typecheck`, `pnpm test`, `pnpm run lint`, and `pnpm build`.
2. Generate fresh snapshots into the production output and verify their `fetched_at`, `source`
   and `coverage` fields from the **public origin**, not just localhost.
3. Open the public overview and `/observe`; confirm Arkade history and Second data load, source
   failures are visible, and the deployed UI is the intended build.
4. Check an Arkade virtual transaction, commitment, address, and asset against their source
   responses. Use both themes and a mobile viewport. Do not interpret sampled overview counts
   as complete network statistics.
5. Load `/unilateral-exit` to check dependency styles. This is not a funded-exit test; do not
   claim execution or recovery guarantees from rendering alone.

The browsing UI and barkd requests are read-only. `/unilateral-exit` can broadcast transactions
after user interaction. Neither the application nor this release checklist is a formal
security audit or proof of Bitcoin consensus.


## Preview Production Build Locally

```bash
pnpm preview
```

## Deployment Options

### Vercel

1. Install Vercel CLI: `pnpm add -g vercel`
2. Run: `vercel`
3. Follow the prompts

### Netlify

1. Install Netlify CLI: `pnpm add -g netlify-cli`
2. Run: `netlify deploy --prod`
3. Set build command: `pnpm build`
4. Set publish directory: `dist`

### Static Hosting (GitHub Pages, etc.)

1. Build the project: `pnpm build`
2. Upload the contents of the `dist` directory to your hosting provider

## Environment-Specific Configuration

For different environments, create separate `.env` files:

- `.env.development` - Development environment
- `.env.production` - Production environment
- `.env.staging` - Staging environment

Vite will automatically load the correct file based on the mode.
