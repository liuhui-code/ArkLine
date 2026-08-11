export class PackagedSoakDeadlineExceeded extends Error {
  constructor(phase) {
    super(`Packaged soak deadline exceeded during ${phase}`);
    this.name = "PackagedSoakDeadlineExceeded";
  }
}

export async function runWithinDeadline(operation, deadline, phase) {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) {
    throw new PackagedSoakDeadlineExceeded(phase);
  }

  let timer = null;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new PackagedSoakDeadlineExceeded(phase)),
          remainingMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function isPackagedSoakDeadlineExceeded(error) {
  return error instanceof PackagedSoakDeadlineExceeded;
}
