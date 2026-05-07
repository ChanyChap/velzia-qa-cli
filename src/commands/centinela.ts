// Comando /centinela — descubre findings, NO aplica fixes.

import fs from "node:fs";
import path from "node:path";
import { AnthropicClient } from "../core/anthropic-client.js";
import { BrowserbaseClient } from "../core/browserbase-client.js";
import { FindingsApi, makeFindingId } from "../core/findings-api.js";
import { SpecsApi } from "../core/specs-api.js";
import { plan, planPendingPriority, type CoverPlan } from "../agents/planner.js";
import { execute } from "../agents/flow-executor.js";
import { uxHeuristicJudge, microcopyJudge, legibilityJudge, mobileFirstJudge, a11yJudge, perfJudge } from "../agents/judges.js";
import { classifyAll, diagnose } from "../core/diagnostician.js";
import { loadEnv } from "../types/config.js";
import type { QaConfig } from "../types/config.js";
import type { FindingDetails } from "../types/finding.js";

interface CentinelaArgs {
  cwd: string;
  mode: "full" | "diff-cover" | "smoke" | "regression-only" | "pending-priority";
  diffFiles?: string[];
  maxFeatures?: number; // solo aplica a pending-priority
}

function readSafe(p: string, fallback = ""): string {
  try { return fs.readFileSync(p, "utf8"); } catch { return fallback; }
}

export async function runCentinela(args: CentinelaArgs): Promise<void> {
  const env = loadEnv();
  const cwd = path.resolve(args.cwd);
  const configPath = path.join(cwd, ".claude", "qa-nocturno.config.json");
  if (!fs.existsSync(configPath)) throw new Error(`No config en ${configPath}`);
  const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as QaConfig;

  const matrixContent = readSafe(path.join(cwd, ".claude", "specs", "full-app-matrix.md"));
  const registryContent = readSafe(path.join(cwd, ".claude", "peticiones-registry.md"));
  const domainContent = readSafe(path.join(cwd, ".claude", "domain-assumptions.md"));

  const anthropic = new AnthropicClient(env);
  const findingsApi = new FindingsApi(env);
  const specsApi = new SpecsApi(env);
  const runId = env.RUN_ID || `centinela-${Date.now()}`;
  let totalCostUsd = 0;
  let passCount = 0, failCount = 0, blockedCount = 0, findingsNew = 0;

  console.log(`[centinela] start runId=${runId} project=${config.slug} mode=${args.mode}`);

  // 1. Plan: pending-priority lee D1 directo (sin LLM); el resto usa Sonnet.
  const cover: CoverPlan = args.mode === "pending-priority"
    ? await planPendingPriority({ config, specsApi, maxFeatures: args.maxFeatures })
    : await plan({
        client: anthropic, config, matrixContent, registryContent, domainContent,
        mode: args.mode, diffFiles: args.diffFiles,
      });
  console.log(`[centinela] cover: ${cover.totalFeatures} features en ${cover.batches.length} batches`);

  // 2. Browser session.
  const browser = new BrowserbaseClient(env);
  await browser.startSession(config);
  await browser.login(config);

  try {
    // 3. Loop por batch (en serie, secuencial — paralelización vendría de N runners GH Actions, no aquí).
    for (const batch of cover.batches) {
      console.log(`[centinela] batch: ${batch.name} (${batch.features.length} features)`);
      for (const feature of batch.features) {
        const r = await execute({
          client: anthropic, browser, config, feature,
          projectId: env.QA_USER_PROJECT_ID,
        });
        if (r.verdict === "PASS") passCount++;
        else if (r.verdict === "FAIL") failCount++;
        else blockedCount++;

        // Si la feature viene de la tabla specs, reportar verdict para que la
        // página /specs muestre el último estado y recalcule pass_streak.
        if (feature.specId) {
          await specsApi.reportVerdict(
            feature.specId,
            r.verdict,
            runId,
            feature.passStreak || 0,
          ).catch((e) => console.warn(`[centinela] specs.reportVerdict ${feature.specId}: ${e.message}`));
        }

        // Si FAIL o errores network → emitir finding type=bug enriquecido.
        if (r.verdict === "FAIL" || r.networkErrors.length > 0 || r.consoleErrors.length > 0) {
          const summary = r.verdict === "FAIL"
            ? r.failNote || `Feature "${feature.name}" falló`
            : `Errores en "${feature.name}"`;

          // 1. Clasificar cada error de red por capa (Supabase / backend / third-party).
          const networkErrorsClassified = classifyAll(r.networkErrors, config.urls.prod);

          // 2. Diagnóstico humano: reglas heurísticas primero, fallback Haiku si no matchea.
          const diag = await diagnose(
            {
              featureName: feature.name,
              featureUrl: feature.url,
              finalUrl: r.finalUrl,
              failNote: r.failNote,
              blockReason: r.blockReason,
              networkErrors: networkErrorsClassified,
              consoleErrors: r.consoleErrors,
            },
            anthropic,
          );

          const details: FindingDetails = {
            feature: {
              id: feature.id,
              name: feature.name,
              url: feature.url,
              source: feature.source,
              criticality: feature.criticality,
            },
            qaFlow: {
              available: feature.qaFlowAvailable,
              stepsExecuted: r.stepsExecuted,
            },
            evidence: {
              networkErrors: networkErrorsClassified,
              consoleErrors: r.consoleErrors,
              failNote: r.failNote,
              blockReason: r.blockReason,
              finalUrl: r.finalUrl,
              durationMs: r.durationMs,
            },
            risks: diag.risks,
            diagnosis: diag.diagnosis,
          };

          await findingsApi.upsert({
            id: makeFindingId(config.slug, "bug", feature.url || feature.name, summary),
            projectSlug: config.slug,
            type: "bug",
            severity: r.verdict === "FAIL" ? "alta" : "media",
            area: feature.url || feature.name,
            summary,
            rootCause: networkErrorsClassified
              .slice(0, 5)
              .map((e) => `[${e.layer}] ${e.endpoint} → ${e.status}`)
              .concat(r.consoleErrors.slice(0, 3))
              .join(" · "),
            recommendation: diag.recommendation,
            applyEnabled: false,
            fixes: [],
            fixesAlternatives: [],
            blastRadius: { fileCount: 0, lineCount: 0, sensitiveDirs: [] },
            state: "open",
            detectedByRuns: [runId],
            attempts: [],
            details,
          });
          findingsNew++;
        }

        // Si PASS → ejecutar los 6 jueces.
        if (r.verdict === "PASS") {
          const ctx = { client: anthropic, browser, config, area: feature.url || feature.name, runId, feature };
          const judgeResults = await Promise.allSettled([
            uxHeuristicJudge(ctx),
            microcopyJudge(ctx),
            legibilityJudge(ctx),
            mobileFirstJudge(ctx),
            a11yJudge(ctx),
            perfJudge(ctx),
          ]);
          for (const jr of judgeResults) {
            if (jr.status !== "fulfilled") continue;
            for (const finding of jr.value) {
              await findingsApi.upsert(finding);
              findingsNew++;
            }
          }
        }
      }
    }
  } finally {
    await browser.closeSession();
    // Cerrar run.
    await findingsApi.closeRun(runId, {
      status: "done", passCount, failCount, blockedCount, findingsNew,
      costUsd: totalCostUsd,
      githubRunUrl: process.env.GITHUB_SERVER_URL ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : undefined,
    }).catch(() => {});
  }

  console.log(`[centinela] done: pass=${passCount} fail=${failCount} blocked=${blockedCount} new findings=${findingsNew} cost=$${totalCostUsd.toFixed(2)}`);
}
