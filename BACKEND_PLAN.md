# ark-observer backend — data collection & serving plan

A separate, single-process backend for ark.observer that records Ark-layer activity permanently,
serves it to the SPA, and watches expiries server-side. Lives beside the static site on the
existing VM. This is a plan; nothing here is implemented yet.

## Why (from measured facts, not speculation)

The Ark layer is the most ephemeral data we depend on:

- The operator's `/v1/txs` stream has **no replay**. Missed events are gone forever.
- The Arkade indexer's VTXO retention is a courtesy service with no contract; its own
  browser front-end (arkade.space) is currently broken.
- Second publishes **no VTXO index at all** — only live gRPC params and the server's on-chain
  P2TR activity.
- Only the Bitcoin anchor layer (commitments) is permanently available (any Esplora/node).

Volumes are tiny: ~44 virtual txs/day (Arkade mainnet), ~9 commitments per window, ~40 Second
server txs/day. Even 10× growth is a few thousand events/day — kilobytes. This drives every
choice below: **SQLite, one process, no Redis, no clusters**.

## Architecture

```
                ┌─────────────────────────────── ark-observerd (Bun/TS, one process) ──────────────────────────────┐
 upstream       │  ingest                                                                                     │  serve       │
 arkade.computer│   • SSE recorder  (holds ONE upstream /v1/txs connection, 24/7, resume from cursor)             │  GET /api/v1 │
   /v1/txs  ────┼──▶• param poller   (/v1/info → operator_params history)                                        │  …activity   │
   /v1/info ────┼──▶• outpoint poller(stream outpoints + watch scripts → indexer vtxos → state deltas)            │  …vtxos      │
   /indexer ────┼──▶• round confirmer(commitment txids → Esplora block height)                                    │  …rounds     │
 ark.second.tech│   • Second poller (gRPC-web info/next-round + Esplora server-P2TR txs)                          │  …stats      │
 mempool.space ─┼──▶• tip sampler    (chain height every 10 min)                                                  │  …operators  │
                │                                                                                               │  SSE /api/v1/stream (re-broadcast)
                │   SQLite (WAL) ── events_YYYYMM (raw, append-only) ── state tables ── stats_daily (materialized)│  POST /api/v1/watch*
                └──────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Runtime**: TypeScript on Bun (single `Bun.serve`, `bun:sqlite`, built-in cron via setInterval).
  Chosen for shared types with the SPA, one-file deploy on the VM, zero containers. Go is the
  fallback if a static binary is ever preferred.
- **Store**: SQLite with WAL. Core tables use only portable types (BIGINT sats, INTEGER unix
  seconds, TEXT ids) and no SQLite-only features, so the schema transplants to Postgres
  unchanged if volume ever justifies it (migration path below).
- **mempool.space lessons applied** (researched from their repo): store *derived* Ark-layer data,
  never mirror on-chain bodies (Esplora is the permanent source for those); hand-rolled versioned
  migrations tracked in a `state` table; materialized daily aggregates computed by skipping
  already-done timestamps; reorg/stale handling via flags + invalidate-derived-from-height;
  keyset pagination; per-network = separate DB file (their per-network MySQL/Redis DB trick,
  simplified).

## Data model

Conventions: all ids TEXT; all sats BIGINT; all times INTEGER unix seconds UTC;
`received_at` (when we saw it) is always stored separately from event/chain time so ingestion
lag is measurable. Every table carries `operator_id` — multi-operator from day one.

### Dimensions

```sql
operators(id TEXT PK, slug, kind TEXT CHECK(kind IN ('arkade','bark','arkd-generic')),
          base_url, grpc_url, chain TEXT, signer_pubkey, first_seen, last_seen, is_active)

-- slowly-changing operator parameters (exit delay etc. change over time)
operator_params(operator_id, effective_from, exit_delay_secs, exit_delta_blocks,
                round_interval_secs, vtxo_lifetime_blocks, min/max amounts, raw_json,
                PRIMARY KEY(operator_id, effective_from))
```

### Raw layer — append-only recorder log (the archive)

```sql
-- ONE MONTHLY TABLE per month, created on demand:
events_YYYYMM(
  id INTEGER PK,                -- monotonic within file, keyset cursor
  operator_id TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  event_type TEXT NOT NULL,     -- commitment_tx|ark_tx|vtxo|round|sweep_tx|heartbeat|poll_snapshot|...
  dedupe_key TEXT NOT NULL,     -- e.g. "commitment_tx:<txid>"; UNIQUE index → idempotent ingest
  txid TEXT,
  payload_json TEXT NOT NULL)   -- verbatim upstream notification: future re-derivation
CREATE UNIQUE INDEX ix_eYYYYMM_dedupe ON events_YYYYMM(operator_id, dedupe_key);
-- plus a UNION ALL view `events` over all months for cross-month queries.
```

Partitioning rationale: SQLite has no native partitioning; monthly tables give the same wins —
bounded index size, cheap archiving (an old month = one file to gzip cold or delete), and
prunable history without `VACUUM`-ing the live DB. On Postgres this becomes `PARTITION BY
RANGE (received_at)` monthly with zero model change.

### State layer — current, queryable truth (derived from events + polls)

```sql
-- rounds == Arkade commitment batches / Second rounds. The on-chain anchor.
rounds(operator_id, txid, started_at, confirmed_height, confirmed_at, block_hash,
       stale INTEGER DEFAULT 0,            -- set on reorg (mempool pattern: flag, never delete)
       total_vtxos INTEGER, total_sats BIGINT, raw_json,
       PRIMARY KEY(operator_id, txid))

-- virtual transactions (off-chain), operator-scoped identity
vtxs(operator_id, txid, kind TEXT,        -- ark_tx|round_tx|sweep
     created_at, input_count, output_count, total_sats BIGINT,
     round_txid TEXT REFERENCES rounds, raw_json,
     PRIMARY KEY(operator_id, txid))

-- VTXOs: current lifecycle state, refreshed by the outpoint poller
vtxos(operator_id, txid, vout,            -- (txid:vout) identity
      amount BIGINT, script TEXT,
      created_at, expires_at INTEGER, expires_at_height INTEGER,
      state TEXT CHECK(state IN ('active','locked','spent','settled','expired','exited')),
      spent_by_txid, settled_by_txid,
      first_commitment_txid, last_commitment_txid,   -- refresh chains
      last_checked_at, raw_json,
      PRIMARY KEY(operator_id, txid, vout))
CREATE INDEX ix_vtxos_expiry ON vtxos(operator_id, state, expires_at);
CREATE INDEX ix_vtxos_script ON vtxos(operator_id, script);

-- append-only lifecycle detail (one row per observed transition)
vtxo_events(operator_id, txid, vout, at, event_type,  -- created|spent|settled|expired_detected|refreshed
            via_txid, round_txid,
            PRIMARY KEY(operator_id, txid, vout, at, event_type))

-- on-chain activity touching operator-published addresses (Second server P2TR today)
operator_chain_txs(operator_id, txid, direction,  -- to_server|from_server|other
                   block_height, block_time, total_sats BIGINT, stale INTEGER DEFAULT 0,
                   PRIMARY KEY(operator_id, txid))

chain_tips(chain, height, block_hash, sampled_at)   -- every 10 min; >90d rows pruned
```

### Aggregates — materialized, never dropped (the charts)

```sql
stats_daily(operator_id, day,               -- unix midnight UTC
            vtxos_created, vtxos_spent, vtxos_expired, vtxos_active_eod,
            value_created_sats BIGINT, value_spent_sats BIGINT,
            rounds, round_value_sats BIGINT,
            ark_txs, sweep_txs,
            median_lifetime_before_spend_secs INTEGER,
            PRIMARY KEY(operator_id, day))
-- computed like mempool.space's hashrates: skip already-materialized days,
-- recompute a day only when invalidated (stale round / reorg / backfill) by
-- DELETE FROM stats_daily WHERE day >= <fork> then re-walk events.
```

### Watch & notify (the only write API)

```sql
watch_items(id, script, label, note, created_at, active)
watch_checks(item_id, checked_at, active_count, nearest_expires_at, result_json,
             PRIMARY KEY(item_id, checked_at))
notification_channels(id, kind, config_json, active)   -- webhook|nostr|email (future kinds)
notification_rules(item_id, channel_id, min_urgency, last_sent_at)
notifications(id, rule_id, sent_at, event_type, payload_json)
```

### Bookkeeping

```sql
state(key TEXT PK, value TEXT)              -- schema_version, ingest cursors per source
ingestion_state(source TEXT PK, cursor TEXT, last_event_id INTEGER, updated_at, last_error)
```

## Partitioning, retention, reorgs

| Data | Partitioning | Retention |
|---|---|---|
| `events_YYYYMM` | monthly tables (+ view) | forever by default; optional policy gzips months older than N to `archive/` (deletable without touching live DB) |
| state tables | none (small) | forever; `chain_tips` pruned > 90 days |
| `stats_daily` | none | forever |
| on-chain bodies | **not stored** | Esplora is the permanent source |

Reorgs/stale rounds: when a confirmed round's height disappears from Esplora, set `stale=1`,
keep history, and invalidate `stats_daily` from that day forward for recompute (mempool.space's
`$handleReorgs` + derived-invalidation pattern, simplified).

## Serving API (v1, JSON, read-only except watch)

- `GET /activity?operator=&before_id=&limit=` — keyset pagination over the event log.
- `GET /vtxos?operator=&state=&script=&expires_before=` — current state.
- `GET /rounds?operator=&confirmed=&before_height=&limit=`
- `GET /stats/daily?operator=&from=&to=`
- `GET /operators` — dimension + live params.
- `GET /stream` — **SSE re-broadcast**: the backend holds the single upstream connection and
  fans out to browsers. This fixes the fragile browser→operator SSE path permanently and gives
  every visitor the live feed with history backfill from `/activity`.
- `POST/GET/DELETE /watch/items`, `GET /watch/state` — bearer-token; scripts only, never keys.
- Reads cached with `ETag`/`Last-Modified`; SPA polls with cursors.

## Ops

- systemd unit on `ungovernable` (`Restart=always`, `MemoryMax=512M`); static site unchanged.
- Backup: nightly `sqlite3 .backup` + rsync off-VM (or Litestream if continuous is wanted).
- Deploy: `rsync` binary+assets, restart unit; migrations run on boot behind the `state` version.
- Health: `GET /healthz` returns per-source `last_success_at` — stale sources page visibly.

## Build order

1. **Recorder** (SSE → `events_YYYYMM` + `operators`/`operator_params`) — stops data loss now.
2. State layer (rounds/vtxos/vtxo_events) + `/activity`, `/rounds`, `/vtxos`; SPA's snapshot
   backfill switches to `/activity`.
3. `stats_daily` + `/stats/daily`; charts on the SPA.
4. Watch & notify (checks + webhook channel first; nostr after).
5. `/stream` re-broadcast; SPA drops its direct operator SSE.

Each phase leaves the site working; the recorder alone already captures what nothing else
on earth is keeping.
