import ts from "typescript";

export function collectNamedTests(source, fileName = "test.tsx") {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const names = [];

  function visit(node) {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && (node.expression.text === "it" || node.expression.text === "test")
    ) {
      const [name] = node.arguments;
      if (name && ts.isStringLiteralLike(name)) names.push(name.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return names;
}

export function createTestNameBatches(suiteName, testNames, batchSize) {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error("Frontend gate batch size must be a positive integer");
  }
  const batches = [];
  for (let index = 0; index < testNames.length; index += batchSize) {
    const names = testNames.slice(index, index + batchSize);
    batches.push(`^(?:${names.map((name) => escapeRegExp(`${suiteName} ${name}`)).join("|")})$`);
  }
  return batches;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
