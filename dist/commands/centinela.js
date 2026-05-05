// Comando /centinela — descubre findings, NO aplica fixes.
import fs from "node:fs";
import path from "node:path";
import { AnthropicClient } from "../core/anthropic-client.js";
import { BrowserbaseClient } from "../core/browserbase-client.js";
import { FindingsApi, makeFindingId } from "../core/findings-api.js";
import { plan } from "../agents/planner.js";
import { execute } from "../agents/flow-executor.js";
import { uxHeuristicJudge, microcopyJudge, legibilityJudge, mobileFirstJudge, a11yJudge, perfJudge } from "../agents/judges.js";
import { loadEnv } from "../types/config.js";
function readSafe(p, fallback = "") {
    try {
        return fs.readFileSync(p, "utf8");
    }
    catch {
        return fallback;
    }
}
export async function runCentinela(args) {
    const env = loadEnv();
    const cwd = path.resolve(args.cwd);
    const configPath = path.join(cwd, ".claude", "qa-nocturno.config.json");
    if (!fs.existsSync(configPath))
        throw new Error(`No config en ${configPath}`);
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const matrixContent = readSafe(path.join(cwd, ".claude", "specs", "full-app-matrix.md"));
    const registryContent = readSafe(path.join(cwd, ".claude", "peticiones-registry.md"));
    const domainContent = readSafe(path.join(cwd, ".claude", "domain-assumptions.md"));
    const anthropic = new AnthropicClient(env);
    const findingsApi = new FindingsApi(env);
    const runId = env.RUN_ID || `centinela-${Date.now()}`;
    let totalCostUsd = 0;
    let passCount = 0, failCount = 0, blockedCount = 0, findingsNew = 0;
    console.log(`[centinela] start runId=${runId} project=${config.slug} mode=${args.mode}`);
    // 1. Plan.
    const cover = await plan({
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
                if (r.verdict === "PASS")
                    passCount++;
                else if (r.verdict === "FAIL")
                    failCount++;
                else
                    blockedCount++;
                // Si FAIL o errores network → emitir finding type=bug.
                if (r.verdict === "FAIL" || r.networkErrors.length > 0 || r.consoleErrors.length > 0) {
                    const summary = r.verdict === "FAIL"
                        ? r.failNote || `Feature ${feature.id} falló`
                        : `Errores de red/consola en ${feature.url || feature.name}`;
                    await findingsApi.upsert({
                        id: makeFindingId(config.slug, "bug", feature.url || feature.name, summary),
                        projectSlug: config.slug,
                        type: "bug",
                        severity: r.verdict === "FAIL" ? "alta" : "media",
                        area: feature.url || feature.name,
                        summary,
                        rootCause: [
                            ...(r.networkErrors.slice(0, 3).map((e) => `${e.endpoint} → ${e.status}`)),
                            ...(r.consoleErrors.slice(0, 3)),
                        ].join(" · "),
                        recommendation: "Revisar el endpoint o consola para identificar causa raíz.",
                        applyEnabled: false,
                        fixes: [],
                        fixesAlternatives: [],
                        blastRadius: { fileCount: 0, lineCount: 0, sensitiveDirs: [] },
                        state: "open",
                        detectedByRuns: [runId],
                        attempts: [],
                    });
                    findingsNew++;
                }
                // Si PASS → ejecutar los 6 jueces.
                if (r.verdict === "PASS") {
                    const ctx = { client: anthropic, browser, config, area: feature.url || feature.name, runId };
                    const judgeResults = await Promise.allSettled([
                        uxHeuristicJudge(ctx),
                        microcopyJudge(ctx),
                        legibilityJudge(ctx),
                        mobileFirstJudge(ctx),
                        a11yJudge(ctx),
                        perfJudge(ctx),
                    ]);
                    for (const jr of judgeResults) {
                        if (jr.status !== "fulfilled")
                            continue;
                        for (const finding of jr.value) {
                            await findingsApi.upsert(finding);
                            findingsNew++;
                        }
                    }
                }
            }
        }
    }
    finally {
        await browser.closeSession();
        // Cerrar run.
        await findingsApi.closeRun(runId, {
            status: "done", passCount, failCount, blockedCount, findingsNew,
            costUsd: totalCostUsd,
            githubRunUrl: process.env.GITHUB_SERVER_URL ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : undefined,
        }).catch(() => { });
    }
    console.log(`[centinela] done: pass=${passCount} fail=${failCount} blocked=${blockedCount} new findings=${findingsNew} cost=$${totalCostUsd.toFixed(2)}`);
}
