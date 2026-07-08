export type SearchPreviewLoaderOptions = {
  path: string;
  requestId: number;
  delayMs: number;
  readFile: (path: string) => Promise<string | null>;
  isCurrent: (requestId: number) => boolean;
  onPreview: (content: string | null) => void;
};

export function scheduleSearchPreview({
  path,
  requestId,
  delayMs,
  readFile,
  isCurrent,
  onPreview,
}: SearchPreviewLoaderOptions) {
  const timeout = window.setTimeout(() => {
    void readFile(path)
      .then((content) => {
        if (isCurrent(requestId)) onPreview(content);
      })
      .catch(() => {
        if (isCurrent(requestId)) onPreview(null);
      });
  }, delayMs);

  return () => window.clearTimeout(timeout);
}
