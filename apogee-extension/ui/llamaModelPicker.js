import { t } from "../lib/util/i18n.js";

// llama.cpp router mode and multi-model proxies report several ids from
// /v1/models. The picker is a shortcut, not the source of truth: the model
// field stays visible and editable, because a proxy can route by a name the
// server does not list and some builds report ids that are not the name to
// send. Choosing a listed model fills the field; a custom value leaves the
// picker on its placeholder.
export function createLlamaModelPicker({ field, select, row, onChoose } = {}) {
  if (!field || !select || !row) return null;

  const doc = select.ownerDocument;
  const placeholder = doc.createElement("option");
  placeholder.value = "";
  placeholder.textContent = t("chooseDetectedModel");
  select.append(placeholder);

  let models = [];

  function selectModel(value) {
    for (const option of select.querySelectorAll("option")) {
      if (option.value === value) {
        option.selected = true;
        return;
      }
    }
  }

  select.addEventListener("change", () => {
    const value = select.value;
    if (!value) {
      // The placeholder is not a choice. Put the picker back on the field so a
      // click on it cannot leave the two controls disagreeing.
      syncToField();
      return;
    }
    field.value = value;
    onChoose?.(value);
  });

  function setModels(detected, current) {
    models = (Array.isArray(detected) ? detected : []).filter(
      (model) => typeof model === "string" && model,
    );
    row.classList.toggle("hidden", models.length <= 1);
    if (models.length <= 1) return;

    const rendered = [...select.querySelectorAll("option")]
      .slice(1)
      .map((option) => option.value);
    const changed =
      rendered.length !== models.length ||
      rendered.some((value, index) => value !== models[index]);
    if (changed) {
      while (select.firstChild) select.removeChild(select.firstChild);
      select.append(placeholder);
      for (const model of models) {
        const option = doc.createElement("option");
        option.value = model;
        option.textContent = model;
        select.append(option);
      }
    }

    const value = typeof current === "string" ? current.trim() : "";
    selectModel(models.includes(value) ? value : "");
  }

  function syncToField() {
    const value = field.value.trim();
    selectModel(models.includes(value) ? value : "");
  }

  function isDetected(value) {
    return models.includes(typeof value === "string" ? value.trim() : "");
  }

  return { setModels, syncToField, isDetected };
}
