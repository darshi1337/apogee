// A promise and its resolver, for tests that need to hold an async call open
// until another assertion or event has run.
export function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
