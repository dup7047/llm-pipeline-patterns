# llm-pipeline-patterns

Three small, dependency-free TypeScript patterns for the unglamorous half of putting a language model into production: making it reliable, and making it cheap by construction.

These are generalized from the pipeline behind [RentGuard NYC](https://www.rentguard.cc), a live app that turns nine NYC Open Data sources into a streamed AI building report. The full write-up of how that pipeline works is here: [A production language-model pipeline](https://dantepaniccia.dev/case-study/).

The demo is always the easy part. What separates a feature that ships from a feature that dies in production is what happens when a data source stalls, when the model returns a 429, and when an anonymous stranger decides to run your endpoint a thousand times. These three patterns address exactly those three failures.

## 1. Timeout and bounded retry

Every external call gets a hard per-attempt timeout and a small number of retries, on the failures worth retrying and no others. The operation receives an `AbortSignal` so a slow request is actually cancelled, not left running.

```ts
import { withRetry } from "llm-pipeline-patterns";

const res = await withRetry(
  async (signal) => {
    const r = await fetch(url, { signal });
    if (r.status === 429 || r.status >= 500) throw new Error("retryable");
    if (!r.ok) throw new Error("fatal");
    return r.json();
  },
  { timeoutMs: 30_000, attempts: 2, backoffMs: 2_000, retryable: (e) => String(e).includes("retryable") },
);
```

Two attempts is the default on purpose. When a user is waiting, a result that arrives very late is about as useless as one that never arrives, so retrying forever just adds latency.

## 2. Deadline with partial-failure tolerance

When you fan out to several sources, one slow or broken source should degrade one section of the response, not take the whole thing down. `withDeadline` races a promise against a deadline and, on timeout or rejection, resolves with a fallback and a `timedOut` flag instead of throwing.

```ts
import { withDeadline } from "llm-pipeline-patterns";

const results = await Promise.all(
  sources.map((s) => withDeadline(s.fetch(), 5_000, s.fallback)),
);
// Every source resolves. Inspect `timedOut` to label which parts are partial.
```

This is the difference between "one of nine datasets was slow, so that section is marked incomplete" and "the report failed."

## 3. Cost ledger and spend caps

Price every model call in whole cents from its token usage, record it per caller, and gate the next call against a rolling cap. Worst-case spend becomes arithmetic instead of a surprise bill.

```ts
import { CostLedger, costInCents } from "llm-pipeline-patterns";

const ledger = new CostLedger(24 * 60 * 60 * 1000); // 24h window
const pricing = { inputPerMillion: 0.15, outputPerMillion: 0.6 };

if (!ledger.withinCap(caller, 20 /* cents/day */)) throw new Error("cap reached");
// ...make the call...
ledger.record(caller, costInCents({ promptTokens, completionTokens }, pricing));
```

Cents are integers on purpose: floating-point dollars drift once you sum thousands of calls. The in-memory ledger here is a reference; in production, back it with a table and a `sum(cents) where subject = ? and at > since` query.

## All three together

[`src/example.ts`](src/example.ts) composes them into a single guarded model call (gate, then timeout-and-retry, then ledger write) and a `gather` helper that fans out under per-source deadlines.

## Use it

```bash
npm install
npm run typecheck   # strict, no errors
npm run build       # emits dist/
```

Zero runtime dependencies. Copy the file you need or import from the package. TypeScript, strict mode, `noUncheckedIndexedAccess` on.

## Where this came from

I build and ship AI features end to end, with the reliability and cost discipline these patterns represent. RentGuard is the production system they were extracted from; the [case study](https://dantepaniccia.dev/case-study/) walks through the real numbers. If you are putting a model into a product and want it to survive contact with real traffic, [get in touch](https://dantepaniccia.dev).

## License

MIT, see [LICENSE](LICENSE).
