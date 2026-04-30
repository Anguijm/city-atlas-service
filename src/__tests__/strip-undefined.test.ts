import { describe, expect, it } from "vitest";
import { stripUndefined } from "@/pipeline/strip-undefined";

describe("stripUndefined", () => {
  it("removes top-level undefined values", () => {
    const input = { a: "keep", b: undefined, c: 42 };
    expect(stripUndefined(input)).toEqual({ a: "keep", c: 42 });
  });

  it("preserves null values", () => {
    const input = { a: null, b: undefined };
    expect(stripUndefined(input)).toEqual({ a: null });
  });

  it("recursively strips nested undefined", () => {
    const input = { name: { en: "Foo" }, details: { score: undefined, label: "bar" } };
    expect(stripUndefined(input)).toEqual({ name: { en: "Foo" }, details: { label: "bar" } });
  });

  it("preserves defined array elements", () => {
    const input = { tags: ["a", "b"], score: undefined };
    expect(stripUndefined(input)).toEqual({ tags: ["a", "b"] });
  });

  it("strips undefined elements from arrays", () => {
    const input = { items: [undefined, "a", undefined, "b"] };
    expect(stripUndefined(input)).toEqual({ items: ["a", "b"] });
  });

  it("recursively strips objects nested inside arrays", () => {
    const input = { waypoints: [{ name: "Foo", score: undefined }, { name: "Bar", lat: 1.0 }] };
    expect(stripUndefined(input)).toEqual({
      waypoints: [{ name: "Foo" }, { name: "Bar", lat: 1.0 }],
    });
  });

  it("strips undefined from nested arrays", () => {
    const input = { matrix: [[undefined, "a"], ["b", undefined]] };
    expect(stripUndefined(input)).toEqual({ matrix: [["a"], ["b"]] });
  });

  it("handles fully undefined nested object", () => {
    const input = { score: undefined, meta: { x: undefined, y: undefined } };
    expect(stripUndefined(input)).toEqual({ meta: {} });
  });

  it("is a no-op when no undefined values present", () => {
    const input = { id: "abc", lat: 1.23, lng: 4.56, name: { en: "Place" } };
    expect(stripUndefined(input)).toEqual(input);
  });
});
