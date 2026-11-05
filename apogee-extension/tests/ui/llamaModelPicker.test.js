import test from "node:test";
import assert from "node:assert";
import { parseHTML } from "linkedom";

import { createLlamaModelPicker } from "../../ui/llamaModelPicker.js";

function setup() {
  const { document } = parseHTML(`
    <div>
      <div id="row" class="hidden"><select id="select"></select></div>
      <input id="field" />
    </div>
  `);
  const chosen = [];
  const picker = createLlamaModelPicker({
    field: document.getElementById("field"),
    select: document.getElementById("select"),
    row: document.getElementById("row"),
    onChoose: (value) => chosen.push(value),
  });
  return {
    document,
    picker,
    chosen,
    row: document.getElementById("row"),
    select: document.getElementById("select"),
    field: document.getElementById("field"),
  };
}

const optionValues = (select) =>
  [...select.querySelectorAll("option")].map((option) => option.value);

test("the picker stays hidden until more than one model is reported", () => {
  const { picker, row } = setup();

  picker.setModels([], "");
  assert.ok(row.classList.contains("hidden"));

  picker.setModels(["only-model"], "");
  assert.ok(row.classList.contains("hidden"));

  picker.setModels(["first", "second"], "first");
  assert.ok(!row.classList.contains("hidden"));
});

test("the picker lists every model and selects the current one", () => {
  const { picker, select } = setup();

  picker.setModels(["first", "second"], "second");

  assert.deepStrictEqual(optionValues(select), ["", "first", "second"]);
  assert.equal(select.value, "second");
});

test("a custom model name is preserved and leaves the picker on its placeholder", () => {
  const { picker, field, select } = setup();
  field.value = "a-private-alias";

  picker.setModels(["first", "second"], field.value);

  assert.equal(field.value, "a-private-alias");
  assert.equal(select.value, "");
});

test("choosing a model fills the field and reports the choice", () => {
  const { picker, field, select, chosen, document } = setup();
  picker.setModels(["first", "second"], "first");

  [...select.querySelectorAll("option")].find(
    (option) => option.value === "second",
  ).selected = true;
  select.dispatchEvent(new document.defaultView.Event("change"));

  assert.equal(field.value, "second");
  assert.deepStrictEqual(chosen, ["second"]);
});

test("syncToField follows a typed name and clears the picker for a custom one", () => {
  const { picker, field, select } = setup();
  picker.setModels(["first", "second"], "first");

  field.value = "second";
  picker.syncToField();
  assert.equal(select.value, "second");

  field.value = "not-listed";
  picker.syncToField();
  assert.equal(select.value, "");
});

test("missing controls leave the picker disabled instead of throwing", () => {
  assert.equal(createLlamaModelPicker({ field: null }), null);
});
