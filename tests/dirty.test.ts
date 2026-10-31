import { describe, expect, it } from "vitest";
import { snapshotEqual } from "@/lib/dirty";
import { nextListboxIndex, typeaheadIndex } from "@/lib/listbox-nav";

describe("snapshotEqual (dirty detection)", () => {
  const saved = { title: "Titel", features: ["a", "b"], captions: { x: "one" } };

  it("is clean for identical values, even as a new object", () => {
    expect(snapshotEqual(saved, structuredClone(saved))).toBe(true);
  });

  it("becomes dirty on a text change and clean again when changed back", () => {
    const edited = { ...saved, title: "Titel!" };
    expect(snapshotEqual(edited, saved)).toBe(false);
    expect(snapshotEqual({ ...edited, title: "Titel" }, saved)).toBe(true);
  });

  it("tracks repeatable fields: add, remove and reorder", () => {
    expect(snapshotEqual({ ...saved, features: ["a", "b", "c"] }, saved)).toBe(false);
    expect(snapshotEqual({ ...saved, features: ["a"] }, saved)).toBe(false);
    expect(snapshotEqual({ ...saved, features: ["b", "a"] }, saved)).toBe(false);
    expect(snapshotEqual({ ...saved, features: ["a", "b"] }, saved)).toBe(true);
  });

  it("compares nested objects regardless of key order and ignores undefined", () => {
    expect(snapshotEqual({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 })).toBe(true);
    expect(snapshotEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(snapshotEqual({ a: "" }, { a: undefined })).toBe(false);
  });

  it("distinguishes types and null", () => {
    expect(snapshotEqual("1", 1)).toBe(false);
    expect(snapshotEqual(null, {})).toBe(false);
    expect(snapshotEqual([], {})).toBe(false);
    expect(snapshotEqual(true, true)).toBe(true);
  });

  it("models the save lifecycle: a failed save stays dirty, a successful one resets the baseline", () => {
    let baseline = structuredClone(saved);
    const current = { ...saved, title: "Nieuw" };
    expect(snapshotEqual(current, baseline)).toBe(false); // enabled
    // failed save: baseline untouched → still dirty
    expect(snapshotEqual(current, baseline)).toBe(false);
    // successful save: baseline = the snapshot that was sent
    baseline = structuredClone(current);
    expect(snapshotEqual(current, baseline)).toBe(true); // disabled again
    expect(snapshotEqual({ ...current, title: "Nog eens" }, baseline)).toBe(false); // enabled again
  });
});

describe("listbox keyboard navigation", () => {
  it("moves without wrapping and supports Home/End", () => {
    expect(nextListboxIndex("ArrowDown", 0, 4)).toBe(1);
    expect(nextListboxIndex("ArrowDown", 3, 4)).toBe(3);
    expect(nextListboxIndex("ArrowUp", 0, 4)).toBe(0);
    expect(nextListboxIndex("ArrowUp", 2, 4)).toBe(1);
    expect(nextListboxIndex("Home", 2, 4)).toBe(0);
    expect(nextListboxIndex("End", 0, 4)).toBe(3);
    expect(nextListboxIndex("ArrowDown", 0, 0)).toBe(-1);
  });

  it("type-ahead finds the next matching label, wrapping", () => {
    const labels = ["Not specified", "Client project", "Personal project", "Concept"];
    expect(typeaheadIndex(labels, "c", 0)).toBe(1);
    expect(typeaheadIndex(labels, "c", 1)).toBe(3);
    expect(typeaheadIndex(labels, "p", 0)).toBe(2);
    expect(typeaheadIndex(labels, "z", 0)).toBe(-1);
    expect(typeaheadIndex(labels, "", 0)).toBe(-1);
  });
});
