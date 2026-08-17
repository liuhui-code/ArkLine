import "@testing-library/jest-dom/vitest";

function testLayoutRect(): DOMRect {
  return {
    x: 0,
    y: 0,
    width: 1,
    height: 16,
    top: 0,
    right: 1,
    bottom: 16,
    left: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

function testLayoutRectList(): DOMRectList {
  const rect = testLayoutRect();
  return {
    0: rect,
    item: (index: number) => index === 0 ? rect : null,
    length: 1,
    [Symbol.iterator]: function* iterator() {
      yield rect;
    },
  } as DOMRectList;
}

if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
}

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = function getClientRects() {
    return testLayoutRectList();
  };
}

if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return testLayoutRect();
  };
}

// jsdom intentionally has no layout engine and returns an empty list here.
// CodeMirror's coordinate scanner requires at least one rectangle when hover
// extensions are active, so provide deterministic test-only geometry.
HTMLElement.prototype.getClientRects = function getClientRects() {
  return testLayoutRectList();
};
