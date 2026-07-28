import { describe, expect, it } from "vitest";
import { parseBuildProfileModules, parseBuildProfileProducts } from "@/features/build/build-profile-parser";

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

  it("keeps scanning products with comments and nested arrays", () => {
    const profile = `{
      app: {
        products: [
          { name: "default", compatibleSdkVersion: ["5.0.0"] },
          /* product comment */ { name: "enterprise", signing: { ids: ["a", "b"] } }
        ]
      }
    }`;

    expect(parseBuildProfileProducts(profile)).toEqual(["default", "enterprise"]);
  });

  it("extracts declared module names independently from products", () => {
    const profile = `{ modules: [{ name: "entry", srcPath: "./entry" }, { name: "feature" }] }`;

    expect(parseBuildProfileModules(profile)).toEqual(["entry", "feature"]);
  });
});
