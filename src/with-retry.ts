export interface RetryOptions {
  /** Hard timeout per attempt, in milliseconds. */
  timeoutMs?: number;
  /** Total attempts, including the first. 2 means one retry. */
  attempts?: number;
  /** Base backoff between attempts, in milliseconds. Doubled each retry. */
  backoffMs?: number;
  /** Given a thrown error, decide whether another attempt is worthwhile. */
  retryable?: (error: unknown) => boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run an async operation with a per-attempt timeout and bounded retries.
 *
 * The operation receives an AbortSignal that fires when its attempt times out;
 * pass it to fetch (or any abortable call) so a slow request is actually
 * cancelled instead of left dangling.
 *
 * The default of two attempts is deliberate. When a user is waiting on the
 * result, a request that resolves very late is about as useless as one that
 * fails, so retrying forever buys nothing and costs latency.
 */
export async function withRetry<T>(
  op: (signal: AbortSignal) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    timeoutMs = 30_000,
    attempts = 2,
    backoffMs = 1_000,
    retryable = () => true,
  } = options;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await op(controller.signal);
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !retryable(error)) throw error;
      await sleep(backoffMs * 2 ** (attempt - 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}
