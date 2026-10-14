// Effective-config view (#416): renders the active setup with secret
// values already hidden by getRedactedSettings. Values go through
// textContent only, never HTML, so a hostile-looking value cannot break
// out of its row. No chrome dependencies; plain Node tests drive this
// with linkedom elements.
export function renderEffectiveConfig(container, entries) {
  if (!container) return;
  container.textContent = "";
  const list = container.ownerDocument.createElement("dl");
  list.className = "effective-config-list";
  for (const { key, value, isDefault } of entries) {
    const term = container.ownerDocument.createElement("dt");
    term.className = "effective-config-key";
    term.textContent = key;
    const detail = container.ownerDocument.createElement("dd");
    detail.className = "effective-config-value";
    detail.textContent = isDefault ? `${value} (default)` : String(value);
    list.append(term, detail);
  }
  container.appendChild(list);
}
