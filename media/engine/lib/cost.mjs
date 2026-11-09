// Run budget: price lookup + a ledger that refuses a paid call which would
// cross the cap. Prices are estimates (see config.mjs).

import { CONFIG } from './config.mjs';
import { UserError } from './errors.mjs';

export class BudgetExceededError extends UserError {}

/** Per-second i2v price for a given instant, from the dated price windows. */
export function clipPricePerSecond(at = new Date(), windows = CONFIG.prices.clipPerSecond) {
  const t = at.getTime();
  const match = windows.find((w) => w.until === null || t < Date.parse(w.until));
  if (!match) throw new Error('No clip price window matches; check CONFIG.prices.clipPerSecond');
  return match.usd;
}

export function estimateClipCost(durationSec, at = new Date()) {
  return durationSec * clipPricePerSecond(at);
}

export function estimateTtsCost(text) {
  return (text.length / 1000) * CONFIG.prices.ttsPerThousandChars;
}

export const estimateStillCost = () => CONFIG.prices.stillPerImage;

export class CostLedger {
  constructor({ maxUsd, enforce = true }) {
    this.maxUsd = maxUsd;
    this.enforce = enforce;
    this.items = [];
  }

  get spentUsd() {
    return this.items.filter((i) => i.paid).reduce((s, i) => s + i.usd, 0);
  }

  get plannedUsd() {
    return this.items.reduce((s, i) => s + i.usd, 0);
  }

  /** Throw before a paid call that would exceed the cap. */
  authorize(label, usd) {
    if (this.enforce && this.spentUsd + usd > this.maxUsd + 1e-9) {
      throw new BudgetExceededError(
        `Budget cap $${this.maxUsd.toFixed(2)} would be exceeded by "${label}" ` +
          `($${usd.toFixed(3)}; spent so far $${this.spentUsd.toFixed(3)}). Raise --max-cost to continue.`,
      );
    }
  }

  record(label, usd, { paid }) {
    this.items.push({ label, usd, paid });
  }

  summary() {
    const lines = this.items.map(
      (i) => `  ${i.paid ? 'PAID ' : 'plan '} $${i.usd.toFixed(3).padStart(7)}  ${i.label}`,
    );
    return [
      ...lines,
      `  total paid this run: $${this.spentUsd.toFixed(3)} (estimate; cap $${this.maxUsd.toFixed(2)})`,
    ].join('\n');
  }
}
