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

// Capa donde ocurrió el error de red. Permite a la UI agruparlos por dueño:
// Supabase (RLS, single() sin fila) vs backend (handler revienta) vs terceros.
export type NetworkLayer = "supabase" | "backend" | "third-party" | "unknown";

export interface NetworkErrorClassified {
  endpoint: string;
  status: number;
  method?: string;
  layer: NetworkLayer;
}

export interface ExecutedStep {
  action: string;        // "navigate" | "wait" | "click" | "fill" | ...
  selector?: string;     // si aplica
  result: string;        // "ok", "timeout", "404", "encontrado tras 320ms", etc.
  durationMs?: number;
}

export interface FindingDetails {
  // Qué feature del cover se estaba probando.
  feature?: {
    id: string;
    name: string;
    url?: string;
    source: "matrix" | "registry" | "domain-bootstrap" | "manual";
    criticality?: Severity;
  };
  // Pasos que ejecutó el flow-executor (hoy básicos: navigate + wait).
  qaFlow?: {
    available: boolean;          // true si el registry traía un qa_flow
    stepsExecuted: ExecutedStep[];
  };
  // Lo que se observó: errores agrupados, screenshot path, veredicto.
  evidence?: {
    networkErrors: NetworkErrorClassified[];
    consoleErrors: string[];
    failNote?: string;           // razón humana del FAIL
    blockReason?: string;        // razón humana del BLOCKED
    finalUrl?: string;
    durationMs?: number;
    screenshotR2Key?: string;
  };
  // Riesgos para Chany al aprobar/rechazar el finding.
  risks?: string[];
  // Texto narrativo "qué pasa aquí" en lenguaje natural — mix reglas + LLM.
  diagnosis?: string;
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
  // Información rica que la página /decisiones renderiza para que Chany pueda decidir.
  details?: FindingDetails;
}
