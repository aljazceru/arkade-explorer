/**
 * Semantic tones of the Atlas design system. Colour encodes layer or urgency,
 * never vendor: `chain` is on-chain/Bitcoin, `virt` the virtual layer, `cp`
 * checkpoints, `alert` the exit window, `ok` healthy, `warning` degraded
 * evidence, `faint` history.
 */
export type AtlasTone = "neutral" | "virt" | "chain" | "cp" | "ok" | "alert" | "warning" | "faint";
