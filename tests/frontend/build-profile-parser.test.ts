import { describe, expect, it } from "vitest";
import { parseBuildProfileProducts } from "@/features/build/build-profile-parser";

describe("build profile parser", () => {
  it("extracts products from Harmony build-profile json5 text", () => {
    const profile = `
      {
        app: { products: [{ name: "default" }, { name: "china" }] },
        modules: []
      }
    `;

    expect(parseBuildProfileProducts(profile)).toEqual(["default", "china"]);
  });

  it("dedupes product names and prefers stable source order", () => {
    const profile = `{ products: [{ name: 'default' }, { name: "default" }, { name: "beta" }] }`;

    expect(parseBuildProfileProducts(profile)).toEqual(["default", "beta"]);
  });

  it("falls back to default when no products are detected", () => {
    expect(parseBuildProfileProducts("{ modules: [] }")).toEqual(["default"]);
  });
});
