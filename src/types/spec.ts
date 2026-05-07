// Spec — entrada en la bandeja unificada de cosas a probar.
// Vive en la tabla `specs` de D1 (Worker qa-velzia). Centinela lee las pending
// y al terminar cada una reporta verdict via PATCH /api/specs/:id.

export type SpecSource = "matrix" | "registry" | "manual";

export type SpecState =
  | "pending"
  | "passing"
  | "failing"
  | "blocked"
  | "needs-translation"
  | "snoozed";

export interface QaFlowStep {
  action:
    | "navigate"
    | "wait"
    | "click"
    | "fill"
    | "select"
    | "hover"
    | "press"
    | "expect"
    | "expect_api"
    | "screenshot";
  url?: string;
  selector?: string;
  value?: string;
  type?: string;       // para expect: "visible" | "hidden" | "text" | "count" | "url" | "attribute"
  endpointMatches?: string;
  status?: number;
  timeoutMs?: number;
  name?: string;       // para screenshot
}

export interface QaFlow {
  steps: QaFlowStep[];
}

export interface Spec {
  id: string;
  projectSlug: string;
  source: SpecSource;
  name: string;
  description?: string;
  qaFlow: QaFlow | null;
  url?: string;
  priority: number;     // 0 = top, 50 = normal, 100 = low
  state: SpecState;
  lastRunId?: string;
  lastVerdict?: "PASS" | "FAIL" | "BLOCKED";
  lastRunAt?: string;
  passStreak: number;
  createdAt: string;
  createdBy: string;
  notes?: string;
}
