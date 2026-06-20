export type RankedPath = {
  path: string;
  score: number;
};

function scorePath(path: string, query: string) {
  const lowerPath = path.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const fileName = lowerPath.split("/").at(-1) ?? lowerPath.split("\\").at(-1) ?? lowerPath;
  const fileStem = fileName.replace(/\.[^.]+$/u, "");

  let score = 0;
  let queryIndex = 0;
  let runLength = 0;

  for (let index = 0; index < lowerPath.length && queryIndex < lowerQuery.length; index += 1) {
    if (lowerPath[index] !== lowerQuery[queryIndex]) {
      runLength = 0;
      continue;
    }

    score += 4;
    runLength += 1;
    queryIndex += 1;

    if (runLength > 1) {
      score += 2;
    }
  }

  if (queryIndex !== lowerQuery.length) {
    return null;
  }

  if (fileStem === lowerQuery) {
    score += 70;
  } else if (fileName === lowerQuery) {
    score += 60;
  } else if (fileName.startsWith(lowerQuery)) {
    score += 45;
  } else if (fileName.includes(lowerQuery)) {
    score += 35;
  }

  if (lowerPath.includes(`/${lowerQuery}`) || lowerPath.includes(`\\${lowerQuery}`)) {
    score += 20;
  }

  if (lowerPath.includes(lowerQuery)) {
    score += 10;
  }

  score -= lowerPath.length * 0.01;

  return score;
}

export function rankPaths(paths: string[], query: string, limit = 50): RankedPath[] {
  const trimmed = query.trim();

  if (!trimmed) {
    return paths.slice(0, limit).map((path) => ({ path, score: 0 }));
  }

  return paths
    .map((path) => {
      const score = scorePath(path, trimmed);
      return score === null ? null : { path, score };
    })
    .filter((item): item is RankedPath => item !== null)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.path.localeCompare(right.path);
    })
    .slice(0, limit);
}
