export function createConnectionError(ErrorClass, service, host, err) {
  // The browser's own wording ("Failed to fetch", "NetworkError ...") is for
  // the console, not the person reading the banner.
  console.error(`${service} connection failed:`, err);
  return new ErrorClass(
    `Could not connect to ${service} at ${host}. Is ${service} running and ` +
      `listening on that address?`,
  );
}
