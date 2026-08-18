import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const focusSource = readFileSync(new URL("../src/modal-focus.ts", import.meta.url), "utf8");

function modalSource(name: string): string {
  return readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");
}

const BOUNDED_DIALOG_CLASSES = [
  "docferry-share-modal",
  "docferry-folder-share-modal",
  "docferry-upload-consent-modal",
  "docferry-result-modal"
];

test("UX-02: share edit and fixed dialogs are height-bounded with internal scrolling", () => {
  for (const cls of BOUNDED_DIALOG_CLASSES) {
    assert.ok(styles.includes(`.${cls}`), `${cls} must be styled`);
  }
  const ruleStart = styles.indexOf(".docferry-share-modal,\n.docferry-folder-share-modal,\n.docferry-upload-consent-modal,\n.docferry-result-modal {");
  assert.ok(ruleStart > -1, "the four dialogs must share one bounded rule");
  const rule = styles.slice(ruleStart, styles.indexOf("}", ruleStart));
  assert.match(rule, /max-height:\s*min\(86vh, 720px\)/);
  assert.match(rule, /max-height:\s*min\(86dvh, 720px\)/);
  assert.match(rule, /overflow-y:\s*auto/);
});

test("UX-02: dialogs contain keyboard focus and expose modal dialog semantics", () => {
  assert.match(focusSource, /setAttr\("role", "dialog"\)/);
  assert.match(focusSource, /setAttr\("aria-modal", "true"\)/);
  assert.match(focusSource, /event\.key !== "Tab"/);
  for (const name of ["share-modal.ts", "folder-share-modal.ts", "upload-consent-modal.ts", "result-modal.ts"]) {
    const source = modalSource(name);
    assert.match(source, /import \{ containModalFocus \} from "\.\/modal-focus"/, `${name} imports the helper`);
    assert.match(source, /containModalFocus\(this\)/, `${name} applies focus containment`);
  }
});
