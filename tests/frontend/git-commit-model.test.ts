import {
  evaluateGitCommitDraft,
  gitCommitDraftStorageKey,
  parseGitCommitDraft,
} from "@/features/git/git-commit-model";

describe("git commit model", () => {
  it("requires a subject, staged changes, and a conflict-free tree", () => {
    expect(evaluateGitCommitDraft({ message: "", amend: false, signOff: false }, 1, 0).reason).toBe("Enter a commit message");
    expect(evaluateGitCommitDraft({ message: "Ship it", amend: false, signOff: false }, 0, 0).reason).toBe("Stage changes before committing");
    expect(evaluateGitCommitDraft({ message: "Ship it", amend: false, signOff: false }, 1, 2).reason).toBe("Resolve conflicts before committing");
    expect(evaluateGitCommitDraft({ message: "Ship it", amend: false, signOff: false }, 1, 0).ready).toBe(true);
  });

  it("allows message-only amend and reports a long subject without blocking", () => {
    const readiness = evaluateGitCommitDraft({ message: "x".repeat(73), amend: true, signOff: false }, 0, 0);
    expect(readiness.ready).toBe(true);
    expect(readiness.subjectTooLong).toBe(true);
    expect(readiness.subjectLength).toBe(73);
  });

  it("restores only supported draft fields and scopes drafts by repository", () => {
    expect(parseGitCommitDraft('{"message":"Fix","amend":true,"signOff":true,"extra":1}')).toEqual({
      message: "Fix",
      amend: true,
      signOff: true,
    });
    expect(parseGitCommitDraft("invalid").message).toBe("");
    expect(gitCommitDraftStorageKey("/workspace")).toContain("/workspace");
  });
});
