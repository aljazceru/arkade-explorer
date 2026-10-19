import { bech32m, hex } from "@scure/base";
import { Script } from "@scure/btc-signer/script.js";

const BOT_UA =
    /Twitterbot|facebookexternalhit|Slackbot|Slack-ImgProxy|LinkedInBot|Discordbot|WhatsApp|TelegramBot|Googlebot|bingbot|yandex|Embedly|showyoubot|outbrain|pinterest|vkShare|W3C_Validator|Iframely/i;

const ACCENT_COLOR = "#7f5af0";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function truncate(str, start = 8, end = 8) {
    if (!str || str.length <= start + end + 3) return str || "";
    return `${str.slice(0, start)}...${str.slice(-end)}`;
}

function esc(str) {
    return (str || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function formatSats(satsBigInt) {
    const str = satsBigInt.toString();
    const padded = str.padStart(9, "0");
    const intPart = padded.slice(0, padded.length - 8);
    const decPart = padded.slice(padded.length - 8).replace(/0+$/, "");
    const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return decPart ? `${formattedInt}.${decPart} BTC` : `${formattedInt} BTC`;
}

function formatAmount(amount, decimals) {
    if (decimals === 0) return BigInt(amount).toLocaleString("en-US");
    const str = BigInt(amount).toString();
    const padded = str.padStart(decimals + 1, "0");
    const intPart = padded.slice(0, padded.length - decimals);
    const decPart = padded.slice(padded.length - decimals).replace(/0+$/, "");
    const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return decPart ? `${formattedInt}.${decPart}` : formattedInt;
}

function addressToScriptHex(address) {
    if (/^[0-9a-fA-F]+$/.test(address) && address.length % 2 === 0) {
        return address.toLowerCase();
    }
    // Decode Ark addresses locally to avoid importing the full SDK, which pulls
    // in dependencies that break the Wrangler/esbuild bundle.
    // Format: 1 byte version + 32 bytes server pubkey + 32 bytes VTXO taproot key
    const decoded = bech32m.decodeUnsafe(address, 1023);
    if (!decoded) throw new Error("Invalid address");
    const data = new Uint8Array(bech32m.fromWords(decoded.words));
    if (data.length !== 65) throw new Error("Invalid data length");
    const vtxoTaprootKey = data.slice(33, 65);
    const pkScript = Script.encode(["OP_1", vtxoTaprootKey]);
    return hex.encode(pkScript);
}

async function indexerFetch(indexerUrl, path) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
        const res = await fetch(`${indexerUrl}${path}`, { signal: controller.signal });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

// ---------------------------------------------------------------------------
// Page matching — returns { type, title, description, stats[] } or null
// ---------------------------------------------------------------------------

async function getPageMeta(pagePath, indexerUrl) {
    if (!indexerUrl) {
        return {
            type: "observer",
            label: "",
            id: "",
            title: "ark.observer",
            description: "Implementation-independent Ark observer",
            stats: [],
        };
    }
    // Ark transaction (off-chain)
    const txMatch = pagePath.match(/^\/tx\/([0-9a-fA-F]+)$/);
    if (txMatch) {
        return {
            type: "tx",
            label: "Transaction",
            id: txMatch[1],
            title: `Transaction ${truncate(txMatch[1])} | ark.observer`,
            description: `View Ark transaction ${txMatch[1]}`,
            stats: [],
        };
    }

    // Batch commitment transaction (onchain)
    const commitMatch = pagePath.match(/^\/commitment-tx\/([0-9a-fA-F]+)$/);
    if (commitMatch) {
        const data = await indexerFetch(indexerUrl, `/v1/indexer/commitmentTx/${commitMatch[1]}`);
        const stats = [];
        if (data?.batchCount != null)
            stats.push({ label: "Batches", value: String(data.batchCount) });
        if (data?.createdAt) {
            const d = new Date(data.createdAt);
            if (!isNaN(d.getTime()))
                stats.push({ label: "Date", value: d.toISOString().slice(0, 10) });
        }
        const extra = stats.map((s) => `${s.label}: ${s.value}`).join(" | ");
        return {
            type: "batch",
            label: "Batch Commitment Transaction",
            id: commitMatch[1],
            title: `Batch Commitment Transaction ${truncate(commitMatch[1])} | ark.observer`,
            description: extra
                ? `Ark batch commitment transaction ${truncate(commitMatch[1])} | ${extra}`
                : `View Ark batch commitment transaction ${commitMatch[1]}`,
            stats,
        };
    }

    // Address
    const addrMatch = pagePath.match(/^\/address\/(.+)$/);
    if (addrMatch) {
        const addr = decodeURIComponent(addrMatch[1]);
        const stats = [];
        try {
            const scriptHex = addressToScriptHex(addr);
            const data = await indexerFetch(indexerUrl, `/v1/indexer/vtxos?scripts=${scriptHex}`);
            if (data?.vtxos) {
                let totalSats = 0n;
                let activeCount = 0;
                const assetIds = new Set();
                for (const v of data.vtxos) {
                    const isSpent = (v.spentBy && v.spentBy !== "") || v.isSpent;
                    if (!isSpent) {
                        totalSats += BigInt(v.amount || 0);
                        activeCount++;
                    }
                    if (v.assets) {
                        for (const a of v.assets) {
                            if (a.assetId) assetIds.add(a.assetId);
                        }
                    }
                }
                stats.push({ label: "Balance", value: formatSats(totalSats) });
                stats.push({ label: "Active VTXOs", value: String(activeCount) });
                if (assetIds.size > 0)
                    stats.push({ label: "Assets", value: String(assetIds.size) });
            }
        } catch {
            /* graceful fallback */
        }
        const extra = stats.map((s) => `${s.value}`).join(" | ");
        return {
            type: "address",
            label: "Address",
            id: addr,
            title: `Address ${truncate(addr, 12, 8)} | ark.observer`,
            description: extra ? `${truncate(addr, 12, 8)} | ${extra}` : `View Ark address ${addr}`,
            stats,
        };
    }

    // Asset
    const assetMatch = pagePath.match(/^\/asset\/([0-9a-fA-F]+)$/);
    if (assetMatch) {
        const data = await indexerFetch(
            indexerUrl,
            `/v1/indexer/asset/${encodeURIComponent(assetMatch[1])}`,
        );
        const stats = [];
        let assetLabel = truncate(assetMatch[1]);
        if (data) {
            const ticker = data.metadata?.ticker;
            const name = data.metadata?.name;
            const decimals = data.metadata?.decimals || 0;
            assetLabel = ticker || name || assetLabel;
            if (name) stats.push({ label: "Name", value: name });
            if (ticker && name) stats.push({ label: "Ticker", value: ticker });
            if (data.supply != null)
                stats.push({ label: "Supply", value: formatAmount(data.supply, decimals) });
        }
        const extra = stats.map((s) => `${s.value}`).join(" | ");
        return {
            type: "asset",
            label: assetLabel,
            id: assetMatch[1],
            title: `${assetLabel} | ark.observer`,
            description: extra || `View Ark asset ${assetMatch[1]}`,
            stats,
        };
    }

    return null;
}

// ---------------------------------------------------------------------------
// OG Image generation (1200x630 PNG)
// ---------------------------------------------------------------------------

function buildOgImageSvg(meta) {
    const displayId =
        meta.type === "address"
            ? truncate(meta.id, 16, 12)
            : meta.type === "asset"
              ? ""
              : truncate(meta.id);

    const typeLabel = meta.type === "asset" ? "" : meta.label;

    // Stats: evenly distributed across the width
    const statsCount = meta.stats.length;
    let statsBlock = "";
    if (statsCount > 0) {
        const colWidth = 1040 / statsCount; // usable width = 1200 - 80*2
        const statItems = meta.stats
            .map((s, i) => {
                const x = 80 + i * colWidth;
                return `<text x="${x}" y="420" font-size="52" font-weight="bold" fill="white" font-family="sans-serif">${esc(s.value)}</text>
        <text x="${x}" y="460" font-size="24" fill="#9ca3af" font-family="sans-serif">${esc(s.label.toUpperCase())}</text>`;
            })
            .join("\n");
        statsBlock = statItems;
    } else {
        statsBlock = `<text x="80" y="420" font-size="36" fill="#9ca3af" font-family="sans-serif">Implementation-independent Ark observer</text>`;
    }

    return `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
    <rect width="1200" height="630" fill="#0f0b1a"/>
    <rect width="1200" height="6" fill="${ACCENT_COLOR}"/>
    <text x="80" y="100" font-size="64" font-weight="bold" fill="${ACCENT_COLOR}" font-family="sans-serif">ark.observer</text>
    ${typeLabel ? `<text x="80" y="200" font-size="32" font-weight="bold" fill="${ACCENT_COLOR}" font-family="sans-serif">${esc(typeLabel.toUpperCase())}</text>` : ""}
    ${
        meta.type === "asset"
            ? `<text x="80" y="280" font-size="56" font-weight="bold" fill="white" font-family="sans-serif">${esc(meta.label)}</text>`
            : displayId
              ? `<text x="80" y="${typeLabel ? "270" : "200"}" font-size="38" fill="#d1d5db" font-family="monospace">${esc(displayId)}</text>`
              : ""
    }
    <line x1="80" y1="340" x2="1120" y2="340" stroke="#2d2640" stroke-width="1"/>
    ${statsBlock}
    <line x1="80" y1="520" x2="1120" y2="520" stroke="#2d2640" stroke-width="1"/>
    <text x="80" y="570" font-size="28" fill="#6b7280" font-family="sans-serif">ark.observer</text>
    <text x="1120" y="570" font-size="28" fill="#4b5563" font-family="sans-serif" text-anchor="end">ark.observer</text>
  </svg>`;
}

async function handleOgImage(pagePath, indexerUrl) {
    const meta = await getPageMeta(pagePath, indexerUrl);
    if (!meta) return null;

    const svg = buildOgImageSvg(meta);
    return new Response(svg, {
        headers: {
            "Content-Type": "image/svg+xml",
            "Cache-Control": "public, max-age=3600",
        },
    });
}

// ---------------------------------------------------------------------------
// Meta HTML for bots
// ---------------------------------------------------------------------------

function buildMetaHtml(title, description, pageUrl, ogImageUrl) {
    const t = esc(title);
    const d = esc(description);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${t}</title>
  <meta name="description" content="${d}" />
  <meta property="og:title" content="${t}" />
  <meta property="og:description" content="${d}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${pageUrl}" />
  <meta property="og:image" content="${ogImageUrl}" />
  <meta name="repository" content="https://github.com/aljazceru/arkade-explorer" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${t}" />
  <meta name="twitter:description" content="${d}" />
  <meta name="twitter:image" content="${ogImageUrl}" />
  <meta http-equiv="refresh" content="0;url=${pageUrl}" />
</head>
<body></body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main middleware
// ---------------------------------------------------------------------------

export async function onRequest(context) {
    const url = new URL(context.request.url);
    const path = url.pathname;
    const indexerOrigin = context.env?.OBS_INDEXER?.replace(/\/+$/, "") || null;
    const origin = url.origin;

    // Handle OG image requests: /og-image/address/... /og-image/tx/... etc.
    if (path.startsWith("/og-image/")) {
        const pagePath = path.replace(/^\/og-image/, "");
        try {
            const response = await handleOgImage(pagePath, indexerOrigin);
            if (response) return response;
        } catch {
            // Fall through to 404
        }
        return new Response("Not found", { status: 404 });
    }

    // Bot detection for meta HTML
    const ua = context.request.headers.get("user-agent") || "";
    if (!BOT_UA.test(ua)) {
        return context.next();
    }

    const meta = await getPageMeta(path, indexerOrigin);
    if (!meta) return context.next();

    const ogImageUrl = `${origin}/og-image${path}`;
    return new Response(
        buildMetaHtml(meta.title, meta.description, context.request.url, ogImageUrl),
        { headers: { "Content-Type": "text/html;charset=UTF-8" } },
    );
}
