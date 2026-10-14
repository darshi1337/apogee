// Capped-input helpers: the single source of truth for input caps lives
// in JS (#320). No DOM globals here, so plain Node tests drive these with
// linkedom elements. app.js passes the live elements and saveSettings.
export function setInputMaxLength(input, maxChars) {
  if (input) input.maxLength = maxChars;
}

export function syncCappedInputMaxLengths(pairs) {
  for (const [input, maxChars] of pairs) setInputMaxLength(input, maxChars);
}

export function updateCappedInputCount(input, countEl, maxChars) {
  if (!input || !countEl) return;
  countEl.textContent = `${input.value.length} / ${maxChars}`;
}

export function wireCappedSettingsInput(
  input,
  countEl,
  maxChars,
  settingKey,
  save,
) {
  if (!input) return;
  let saveTimer = null;
  const persist = async () => {
    await save({
      [settingKey]: input.value.slice(0, maxChars).trim(),
    });
  };
  input.addEventListener("input", () => {
    updateCappedInputCount(input, countEl, maxChars);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 500);
  });
  input.addEventListener("blur", () => {
    clearTimeout(saveTimer);
    persist();
  });
}
