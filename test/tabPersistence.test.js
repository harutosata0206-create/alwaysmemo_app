import assert from "node:assert/strict";
import test from "node:test";
import { getDirtyTabIds, getRestoredDirtyTabIds, writeLocalState } from "../src/lib/tabPersistence.ts";

test("the persisted dirty list includes edited and unsaved tabs only", () => {
  const tabs = [
    { id: "clean", title: "memo.txt", content: "saved" },
    { id: "edited", title: "draft", content: "new" },
    { id: "new", title: "new", content: "" },
  ];
  const saved = {
    clean: { title: "memo.txt", content: "saved" },
    edited: { title: "draft", content: "old" },
  };
  assert.deepEqual(getDirtyTabIds(tabs, saved), ["edited", "new"]);
});

test("restored dirty tabs remain dirty, including an emptied file", () => {
  const tabs = [
    { id: "file", title: "memo.txt", content: "", filePath: "memo.txt" },
    { id: "clean", title: "clean", content: "saved" },
  ];
  assert.deepEqual([...getRestoredDirtyTabIds(tabs, ["file"])], ["file"]);
});

test("legacy states conservatively keep nonempty and file-backed tabs unsaved", () => {
  const tabs = [
    { id: "blank", title: "blank", content: "" },
    { id: "draft", title: "draft", content: "draft" },
    { id: "file", title: "memo.txt", content: "", filePath: "memo.txt" },
  ];
  assert.deepEqual([...getRestoredDirtyTabIds(tabs, undefined)], ["draft", "file"]);
});

test("a failed local write leaves the previous recovery state intact", () => {
  let existing = "previous state";
  const storage = {
    setItem() { throw new Error("quota exceeded"); },
    getItem() { return existing; },
  };
  assert.equal(writeLocalState(storage, "state", { tabs: [] }), false);
  assert.equal(storage.getItem("state"), "previous state");
  const workingStorage = { setItem(_key, value) { existing = value; } };
  assert.equal(writeLocalState(workingStorage, "state", { tabs: [] }), true);
  assert.equal(existing, '{"tabs":[]}');
});
