export type FindingType =
  | "bug" | "design-debt" | "ux-debt" | "a11y" | "perf"
  | "security" | "suggestion" | "optimization" | "regression";

export type Severity = "critica" | "alta" | "media" | "baja";

export type FindingState =
  | "open" | "approved" | "rejected" | "snoozed" | "applied" | "duplicate";

export interface Fix {
  path: string;
  description: string;
  old: string;
  new: string;
  replaceAll?: boolean;
  targetSha?: string;
  strategy?: "comment-out" | "revert-commit" | "apply-migration" | "ts-ignore" | "feature-flag";
}

export interface BlastRadius {
  fileCount: number;
  lineCount: number;
  sensitiveDirs: string[];
}

export interface Finding {
  id: string;
  projectSlug: string;
  type: FindingType;
  severity: Severity;
  area: string;
  summary: string;
  rootCause: string;
  recommendation: string;
  applyEnabled: boolean;
  blacklistMatch: string | null;
  blacklistReason: string | null;
  whitelistMatch: string | null;
  fixStrategy: string | null;
  fixes: Fix[];
  fixesAlternatives: Fix[][];
  blastRadius: BlastRadius;
  state: FindingState;
  rejectedReason?: string;
  snoozedUntil?: string;
  duplicateOf?: string;
  firstDetectedAt?: string;
  lastSeenAt?: string;
  detectedByRuns: string[];
  attempts: Array<{ at: string; outcome: string; log: string }>;
  appliedAt?: string;
  appliedCommit?: string;
  appliedBranch?: string;
}
