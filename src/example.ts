import { withRetry } from "./with-retry";
import { withDeadline } from "./with-deadline";
import { CostLedger, costInCents, type ModelPricing } from "./cost-ledger";

// gpt-4o-mini list pricing at the time of writing.
const PRICING: ModelPricing = { inputPerMillion: 0.15, outputPerMillion: 0.6 };

const DAY = 24 * 60 * 60 * 1000;
const ledger = new CostLedger(DAY);
const CAPS_CENTS = { anon: 20, user: 500 };

interface ChatResponse {
  choices: { message: { content: string } }[];
  usage: { prompt_tokens: number; completion_tokens: number };
}

/**
 * One model call with all three patterns composed: a spend gate before the
 * call, a timeout-and-retry around it, and a ledger write after it. Retries
 * only on the failures worth retrying (429 and 5xx), never on a 4xx that will
 * fail again.
 */
export async function summarize(
  subject: { id: string; tier: "anon" | "user" },
  prompt: string,
): Promise<string> {
  if (!ledger.withinCap(subject.id, CAPS_CENTS[subject.tier])) {
    throw new Error("daily spend cap reached for this caller");
  }

  const res = await withRetry<ChatResponse>(
    async (signal) => {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          max_tokens: 1800,
          messages: [{ role: "user", content: prompt }],
        }),
        signal,
      });
      if (r.status === 429 || r.status >= 500) throw new Error(`retryable ${r.status}`);
      if (!r.ok) throw new Error(`fatal ${r.status}`);
      return (await r.json()) as ChatResponse;
    },
    {
      timeoutMs: 30_000,
      attempts: 2,
      backoffMs: 2_000,
      retryable: (error) => String(error).includes("retryable"),
    },
  );

  ledger.record(
    subject.id,
    costInCents(
      {
        promptTokens: res.usage.prompt_tokens,
        completionTokens: res.usage.completion_tokens,
      },
      PRICING,
    ),
  );

  return res.choices[0]?.message.content ?? "";
}

/**
 * Fan out to several sources, each under its own deadline, and keep going even
 * if some are slow or fail. Returns whatever arrived in time, plus the names of
 * the sources that missed, so the caller can label partial results.
 */
export async function gather<T>(
  sources: { name: string; fetch: () => Promise<T>; fallback: T }[],
  perSourceMs = 5_000,
): Promise<{ data: Record<string, T>; partial: string[] }> {
  const results = await Promise.all(
    sources.map((source) => withDeadline(source.fetch(), perSourceMs, source.fallback)),
  );
  const data: Record<string, T> = {};
  const partial: string[] = [];
  results.forEach((result, i) => {
    const source = sources[i];
    if (!source) return;
    data[source.name] = result.value;
    if (result.timedOut) partial.push(source.name);
  });
  return { data, partial };
}
