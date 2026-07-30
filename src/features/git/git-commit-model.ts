export type GitCommitAction = "commit" | "commitAndPush";

export type GitCommitDraft = {
  message: string;
  amend: boolean;
  signOff: boolean;
};

export type GitCommitReadiness = {
  ready: boolean;
  reason: string | null;
  subject: string;
  subjectLength: number;
  subjectTooLong: boolean;
};

export const EMPTY_GIT_COMMIT_DRAFT: GitCommitDraft = {
  message: "",
  amend: false,
  signOff: false,
};

export function evaluateGitCommitDraft(
  draft: GitCommitDraft,
  stagedCount: number,
  conflictCount: number,
): GitCommitReadiness {
  const subject = draft.message.split(/\r?\n/, 1)[0].trim();
  let reason: string | null = null;
  if (!subject) reason = "Enter a commit message";
  else if (conflictCount > 0) reason = "Resolve conflicts before committing";
  else if (stagedCount === 0 && !draft.amend) reason = "Stage changes before committing";
  return {
    ready: reason === null,
    reason,
    subject,
    subjectLength: subject.length,
    subjectTooLong: subject.length > 72,
  };
}

export function gitCommitDraftStorageKey(rootPath: string) {
  return `arkline.git.commit-draft:${rootPath}`;
}

export function parseGitCommitDraft(value: string | null): GitCommitDraft {
  if (!value) return { ...EMPTY_GIT_COMMIT_DRAFT };
  try {
    const parsed = JSON.parse(value) as Partial<GitCommitDraft>;
    return {
      message: typeof parsed.message === "string" ? parsed.message : "",
      amend: parsed.amend === true,
      signOff: parsed.signOff === true,
    };
  } catch {
    return { ...EMPTY_GIT_COMMIT_DRAFT };
  }
}
