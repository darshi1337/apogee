// Race a promise against a timeout, clearing the timer either way.
// Falls back to `onTimeout()` on timeout, else rejects.
export function withTimeout(promise, ms, { onTimeout } = {}) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      if (onTimeout) {
        try {
          resolve(onTimeout());
        } catch (err) {
          reject(err);
        }
      } else {
        reject(new Error(`Timed out after ${ms}ms`));
      }
    }, ms);
  });

  return Promise.race([Promise.resolve(promise), timeout]).finally(() =>
    clearTimeout(timer),
  );
}

// Linear backoff for download retries: longer wait on each attempt.
export function retryDelayForAttempt(baseMs, attempt) {
  return baseMs * attempt;
}
