// qa-planner (Sonnet 4.6) — resuelve el cover del run.

import type { AnthropicClient } from "../core/anthropic-client.js";
import type { QaConfig } from "../types/config.js";
import type { SpecsApi } from "../core/specs-api.js";

export interface PlanFeature {
  id: string;
  name: string;
  source: "matrix" | "registry" | "domain-bootstrap" | "manual";
  qaFlowAvailable: boolean;
  criticality: "critica" | "alta" | "media" | "baja";
  estimatedSec: number;
  url?: string;
  // Si la feature viene de la tabla specs (manual o re-import), guardamos el id
  // para que centinela pueda reportar verdict via SpecsApi.patch al terminar.
  specId?: string;
  passStreak?: number;
}

export interface PlanBatch {
  name: string;
  parallel: number;
  features: PlanFeature[];
  rationale: string;
}

export interface CoverPlan {
  project: string;
  totalFeatures: number;
  estimatedDurationMin: number;
  batches: PlanBatch[];
  skipped: Array<{ id: string; reason: string }>;
}

/**
 * Modo "pending-priority": NO usa LLM. Lee directamente las specs pending o
 * failing de la tabla specs en D1, ordenadas por priority. Las pone TODAS en
 * un solo batch. Pensado para el agente 24/7 que hace ticks cortos.
 */
export async function planPendingPriority(opts: {
  config: QaConfig;
  specsApi: SpecsApi;
  maxFeatures?: number;
}): Promise<CoverPlan> {
  const max = opts.maxFeatures || 50;
  const [pending, failing] = await Promise.all([
    opts.specsApi.list({ project: opts.config.slug, state: "pending" }),
    opts.specsApi.list({ project: opts.config.slug, state: "failing" }),
  ]);
  // Failing primero (algo se rompió, urgente). Pending después.
  const all = [...failing, ...pending].slice(0, max);
  const features: PlanFeature[] = all.map((s) => ({
    id: s.id,
    name: s.name,
    source: s.source === "matrix" ? "matrix" : s.source === "registry" ? "registry" : "manual",
    qaFlowAvailable: !!(s.qaFlow && s.qaFlow.steps?.length),
    criticality: s.priority < 20 ? "alta" : s.priority < 60 ? "media" : "baja",
    estimatedSec: 30,
    url: s.url,
    specId: s.id,
    passStreak: s.passStreak,
  }));
  return {
    project: opts.config.slug,
    totalFeatures: features.length,
    estimatedDurationMin: Math.ceil((features.length * 30) / 60),
    batches: features.length === 0 ? [] : [{
      name: "pending-priority",
      parallel: 1,
      features,
      rationale: `${failing.length} failing + ${pending.length} pending leídas de D1.`,
    }],
    skipped: [],
  };
}

export async function plan(opts: {
  client: AnthropicClient;
  config: QaConfig;
  matrixContent: string;
  registryContent: string;
  domainContent: string;
  mode: "full" | "diff-cover" | "smoke" | "regression-only";
  diffFiles?: string[];
}): Promise<CoverPlan> {
  const staticPrefix = [
    `# Project config: ${opts.config.appName} (${opts.config.slug})`,
    `URL: ${opts.config.urls.prod}`,
    `Engine: ${opts.config.engine.type} parallel=${opts.config.engine.parallel || 1}`,
    `Mobile-first: ${opts.config.mobileFirst ? "yes" : "no"}`,
    "",
    "## Matrix curada:",
    opts.matrixContent.slice(0, 8000),
    "",
    "## Registry pendiente:",
    opts.registryContent.slice(0, 8000),
    "",
    "## Domain assumptions:",
    opts.domainContent.slice(0, 4000),
  ].join("\n");

  const dynamicSuffix = `Modo del run: ${opts.mode}
${opts.diffFiles?.length ? `Archivos cambiados en este push:\n${opts.diffFiles.join("\n")}\n` : ""}

Resuelve el cover de features a probar esta sesión. Devuelve JSON ESTRICTO:

{
  "project": "${opts.config.slug}",
  "totalFeatures": N,
  "estimatedDurationMin": N,
  "batches": [
    {
      "name": "batch-1-auth",
      "parallel": 1,
      "features": [
        { "id": "F001", "name": "Login", "source": "matrix", "qaFlowAvailable": true, "criticality": "critica", "estimatedSec": 45, "url": "/login" }
      ],
      "rationale": "..."
    }
  ],
  "skipped": [{ "id": "...", "reason": "exclusion: ..." }]
}

Reglas:
- En "smoke" → max 10 features marcadas critica.
- En "diff-cover" → solo features que tocan archivos del diff.
- En "full" → todo lo no excluido.
- En "regression-only" → solo entries con prefix "regresion-" en registry.

Aplica exclusions del config: ${JSON.stringify(opts.config.exclusions || [])}.

Respuesta solo JSON, sin texto explicativo.`;

  const r = await opts.client.invoke({
    model: "claude-sonnet-4-6",
    staticPrefix,
    dynamicSuffix,
    maxTokens: 16384,
    includeDefenseBlocks: true,
  });
  return opts.client.parseJson<CoverPlan>(r.text);
}
