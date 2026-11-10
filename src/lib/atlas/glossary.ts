/** One-sentence definitions behind the `?` popovers. Keep them accurate and short. */
export const GLOSSARY = {
    vtxo: {
        term: "VTXO",
        text: "A virtual output: an off-chain coin inside an operator's batch. It can be spent off-chain or exited on-chain, and it expires with its batch.",
    },
    batch: {
        term: "Batch",
        text: "Arkade's commitment transaction: one Bitcoin transaction that anchors many VTXOs at once.",
    },
    round: {
        term: "Round",
        text: "Second's commitment cycle: an hourly round that anchors VTXOs to Bitcoin.",
    },
    commitment: {
        term: "Commitment",
        text: "A Bitcoin transaction that anchors a batch of VTXOs. Arkade calls it a batch, Second a round.",
    },
    tree: {
        term: "Tree",
        text: "A batch's VTXOs sit at the leaves of a transaction tree rooted in the commitment output. Exiting means broadcasting your branch.",
    },
    checkpoint: {
        term: "Checkpoint",
        text: "An intermediate Arkade transaction between a VTXO and the transaction that spends it. It bounds how far back an exit must reach.",
    },
    preconfirmed: {
        term: "Preconfirmed",
        text: "Cosigned off-chain by the operator but not yet settled into a batch on Bitcoin.",
    },
    settled: {
        term: "Settled",
        text: "Unspent and finalized in a batch that is anchored on Bitcoin.",
    },
    exitWindow: {
        term: "Exit window",
        text: "The final stretch before a VTXO's batch expires, roughly as long as the operator's unilateral exit delay (Arkade ≈7 d, Second ≈144 blocks ≈1 d at 10 min/block). Inside it, renew or exit on-chain — but the delay is a heuristic, not a guarantee: deep exits need more confirmations.",
    },
    renew: {
        term: "Renew",
        text: "Refresh a VTXO into a new batch, which resets its expiry.",
    },
    exitDepth: {
        term: "Exit depth",
        text: "How many off-chain transactions a holder must broadcast to exit unilaterally: every hop from the VTXO back to its on-chain commitment.",
    },
    forfeit: {
        term: "Forfeit",
        text: "A pre-signed transaction that lets the operator claim a refreshed VTXO's old funds if they are ever exited unilaterally.",
    },
    connector: {
        term: "Connector",
        text: "A commitment output that makes forfeit transactions valid only once the new batch confirms.",
    },
    anchor: {
        term: "Anchor output",
        text: "A zero-value pay-to-anchor (P2A) output that lets anyone fee-bump the transaction with CPFP during an exit.",
    },
    sweep: {
        term: "Sweep",
        text: "After a batch expires the operator may reclaim its unexited funds; swept VTXOs have no unilateral exit path — recovery requires the operator, in a new batch.",
    },
    unfinalized: {
        term: "Unfinalized spend",
        text: "Spent in a submitted transaction that has not been finalized yet.",
    },
    serverAddress: {
        term: "Server address",
        text: "Second publishes no VTXO index; on-chain transactions touching its published server address are its public footprint.",
    },
} as const;

export type GlossaryKey = keyof typeof GLOSSARY;
