export interface ModelPricing {
  /** USD per 1,000,000 input (prompt) tokens. */
  inputPerMillion: number;
  /** USD per 1,000,000 output (completion) tokens. */
  outputPerMillion: number;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
}

/**
 * Price a single model call in whole cents, rounding up so a call is never
 * recorded as free. Charging in integer cents keeps the running total exact;
 * floating-point dollars drift once you sum thousands of calls.
 */
export function costInCents(usage: Usage, pricing: ModelPricing): number {
  const input = (usage.promptTokens * pricing.inputPerMillion) / 10_000;
  const output = (usage.completionTokens * pricing.outputPerMillion) / 10_000;
  return Math.max(1, Math.ceil(input + output));
}

interface LedgerEntry {
  subject: string;
  cents: number;
  at: number;
}

/**
 * A minimal rolling-window spend ledger. Record every call, then gate the next
 * one against a per-subject cap over a trailing window (a day, an hour).
 *
 * The point is to make worst-case spend arithmetic instead of a surprise: an
 * anonymous caller can never cost more than their cap, by construction. This
 * reference version keeps entries in memory; in production back it with a table
 * and a `sum(cents) where subject = ? and at > since` query.
 */
export class CostLedger {
  private entries: LedgerEntry[] = [];

  constructor(private readonly windowMs: number) {}

  record(subject: string, cents: number, now = Date.now()): void {
    this.entries.push({ subject, cents, at: now });
  }

  spent(subject: string, now = Date.now()): number {
    const since = now - this.windowMs;
    return this.entries
      .filter((entry) => entry.subject === subject && entry.at > since)
      .reduce((sum, entry) => sum + entry.cents, 0);
  }

  withinCap(subject: string, capCents: number, now = Date.now()): boolean {
    return this.spent(subject, now) < capCents;
  }
}
