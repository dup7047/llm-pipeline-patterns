export interface DeadlineResult<T> {
  value: T;
  timedOut: boolean;
}

/**
 * Race a promise against a deadline. On timeout, resolve with `fallback` and
 * `timedOut: true` instead of rejecting; the underlying promise keeps running
 * but its result is discarded. A rejection from the wrapped promise is also
 * absorbed into the fallback, so a single dead dependency never throws.
 *
 * Use this to fan out to many sources and let a slow or failing one degrade a
 * single section of the response instead of taking the whole thing down. The
 * caller inspects `timedOut` to label which parts of the result are partial.
 */
export function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<DeadlineResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<DeadlineResult<T>>((resolve) => {
    timer = setTimeout(() => resolve({ value: fallback, timedOut: true }), ms);
  });
  const settled = promise
    .then((value) => ({ value, timedOut: false }))
    .catch(() => ({ value: fallback, timedOut: false }));
  return Promise.race([settled, timeout]).then((result) => {
    if (timer) clearTimeout(timer);
    return result;
  });
}
