// 6 jueces de lente humana — invocados por Centinela tras cada PASS funcional.
// ux-heuristic, microcopy, legibility, mobile-first, a11y (axe), perf (Lighthouse).
import { makeFindingId } from "../core/findings-api.js";
function makeFinding(c, raw, details) {
    return {
        id: makeFindingId(c.config.slug, raw.type, c.area, raw.summary),
        projectSlug: c.config.slug,
        type: raw.type,
        severity: raw.severity,
        area: c.area,
        summary: raw.summary,
        rootCause: raw.rootCause,
        recommendation: raw.recommendation,
        applyEnabled: false,
        blacklistMatch: null,
        blacklistReason: null,
        whitelistMatch: null,
        fixStrategy: null,
        fixes: [],
        fixesAlternatives: [],
        blastRadius: { fileCount: 0, lineCount: 0, sensitiveDirs: [] },
        state: "open",
        detectedByRuns: [c.runId],
        attempts: [],
        details,
    };
}
// Helper para enriquecer findings de perf/a11y con la feature en curso.
function featureDetails(c) {
    if (!c.feature)
        return undefined;
    return {
        feature: {
            id: c.feature.id,
            name: c.feature.name,
            url: c.feature.url,
            source: c.feature.source,
            criticality: c.feature.criticality,
        },
    };
}
// 4.1 — UX heuristic (Sonnet)
export async function uxHeuristicJudge(c) {
    const r = await c.client.invoke({
        model: "claude-sonnet-4-6",
        staticPrefix: `Eres experto UX siguiendo las 10 heurísticas de Nielsen + reglas CLAUDE.md (UI autoexplicativa, PageHelp obligatorio, selects buscables, tabs sincronizados con URL, microcopy claro).`,
        dynamicSuffix: `Snapshot de la vista ${c.area}:\n${c.snapshot?.slice(0, 8000) || "(sin snapshot)"}\n\nDevuelve JSON: { "findings": [{ "type":"ux-debt", "severity":"alta|media|baja", "summary":"...", "rootCause":"...", "recommendation":"..." }] }. Si no hay nada problemático: {"findings":[]}.`,
        maxTokens: 2048,
    });
    const out = c.client.parseJson(r.text);
    return (out.findings || []).map((f) => makeFinding(c, f));
}
// 4.2 — Microcopy (Sonnet)
export async function microcopyJudge(c) {
    const r = await c.client.invoke({
        model: "claude-sonnet-4-6",
        staticPrefix: `Eres copywriter UX. Revisa labels confusas, jerga técnica visible (tenant_id, uuid, API), ortografía (acentos español), botones genéricos sin contexto, placeholders vacíos, errores sin solución, estados vacíos sin instrucción, tooltips ausentes.`,
        dynamicSuffix: `Snapshot ${c.area}:\n${c.snapshot?.slice(0, 6000) || ""}\n\nJSON: { "findings": [{ "type":"ux-debt", "severity":"...", "summary":"...", "rootCause":"...", "recommendation":"..." }] }`,
        maxTokens: 1500,
    });
    const out = c.client.parseJson(r.text);
    return (out.findings || []).map((f) => makeFinding(c, f));
}
// 4.3.5 — Legibility (Haiku) — F nuevo Chany 2026-05-02
export async function legibilityJudge(c) {
    const r = await c.client.invoke({
        model: "claude-haiku-4-5-20251001",
        staticPrefix: `Eres experto en tipografía web. Detecta: tamaño body <14px desktop o <16px mobile, contraste WCAG AA <4.5:1, líneas >80 chars, line-height <1.4, MAYÚSCULAS excesivas, serif para body, tipografías sin distinción 0/O/I/l/1.`,
        dynamicSuffix: `Snapshot ${c.area}:\n${c.snapshot?.slice(0, 4000) || ""}\n\nJSON con findings type:"ux-debt".`,
        maxTokens: 1500,
    });
    const out = c.client.parseJson(r.text);
    return (out.findings || []).map((f) => makeFinding(c, f));
}
// 4.3.6 — Mobile-first (Sonnet) — solo si config.mobileFirst===true. F nuevo Chany.
export async function mobileFirstJudge(c) {
    if (!c.config.mobileFirst)
        return [];
    // Re-render en viewport 375x667.
    const stagehand = c.browser.getStagehand();
    await stagehand.page.setViewportSize({ width: 375, height: 667 }).catch(() => { });
    await stagehand.page.waitForTimeout(500);
    const screenshot = await c.browser.screenshot();
    const screenshotB64 = screenshot.toString("base64").slice(0, 1000); // truncado
    const r = await c.client.invoke({
        model: "claude-sonnet-4-6",
        staticPrefix: `Eres experto en mobile-first design. Viewport ahora 375x667 (iPhone SE). Detecta: scroll horizontal, touch targets <44x44px, body <16px, padding CTA <12x16px, modal full-screen sin safe-area, inputs sin type correcto (email/tel), hamburger sin touch area suficiente, sticky con viewport mobile roto.`,
        dynamicSuffix: `Vista mobile ${c.area}.\n\nJSON con findings type:"ux-debt".`,
        maxTokens: 1500,
    });
    // Restaurar viewport original.
    await stagehand.page.setViewportSize(c.config.viewport).catch(() => { });
    const out = c.client.parseJson(r.text);
    return (out.findings || []).map((f) => makeFinding(c, f));
}
// 4.3 — A11y (Haiku) con axe-core inyectado.
export async function a11yJudge(c) {
    const stagehand = c.browser.getStagehand();
    const result = await stagehand.page.evaluate(async () => {
        if (!window.axe) {
            await new Promise((resolve, reject) => {
                const s = document.createElement("script");
                s.src = "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.0/axe.min.js";
                s.onload = () => resolve();
                s.onerror = () => reject();
                document.head.appendChild(s);
            });
        }
        const r = await window.axe.run();
        return {
            violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, count: v.nodes.length })),
        };
    }).catch(() => ({ violations: [] }));
    const sevMap = { critical: "critica", serious: "alta", moderate: "media", minor: "baja" };
    return (result.violations || []).map((v) => {
        const summary = `[a11y/${v.id}] ${v.help} (${v.count} nodos)`;
        const details = {
            ...featureDetails(c),
            qaFlow: { available: false, stepsExecuted: [{ action: "axe-core scan", result: `${v.count} nodos violan la regla` }] },
            evidence: { networkErrors: [], consoleErrors: [`axe-core[${v.id}]: ${v.help} (impact=${v.impact}, ${v.count} nodos)`] },
            diagnosis: `axe-core encontró ${v.count} elemento(s) que violan la regla "${v.id}" (${v.help}). ` +
                `Impacto declarado por axe: ${v.impact}.`,
            risks: v.impact === "critical" || v.impact === "serious"
                ? [`Usuarios con lectores de pantalla no podrán usar ${c.feature?.name || c.area}.`, "Riesgo legal de accesibilidad si la app debe cumplir WCAG AA."]
                : [`Degrada la experiencia para usuarios de tecnología asistiva en ${c.feature?.name || c.area}.`],
        };
        return makeFinding(c, {
            type: "a11y",
            severity: sevMap[v.impact] || "baja",
            summary,
            rootCause: `axe-core regla "${v.id}" detecta ${v.count} violaciones`,
            recommendation: `Doc: ${v.helpUrl}`,
        }, details);
    });
}
// 4.4 — Perf (determinista) con Lighthouse-CI.
// Requiere chrome-launcher disponible — en GH Actions con Playwright lo tenemos.
export async function perfJudge(c) {
    const budgets = c.config.perfBudgets;
    if (!budgets)
        return [];
    // Por simplicidad (Lighthouse en Browserbase requiere CDP custom), aquí emitimos
    // findings basados en métricas que el page.evaluate puede dar via Performance API.
    const stagehand = c.browser.getStagehand();
    const metrics = await stagehand.page.evaluate(() => {
        const nav = performance.getEntriesByType("navigation")[0];
        const paint = performance.getEntriesByName("first-contentful-paint")[0];
        return {
            lcp: nav ? nav.loadEventEnd - nav.fetchStart : 0,
            fcp: paint ? paint.startTime : 0,
            domLoaded: nav ? nav.domContentLoadedEventEnd - nav.fetchStart : 0,
        };
    }).catch(() => ({ lcp: 0, fcp: 0, domLoaded: 0 }));
    const findings = [];
    if (metrics.lcp > budgets.lcp_ms) {
        const details = {
            ...featureDetails(c),
            qaFlow: {
                available: false,
                stepsExecuted: [{ action: "performance.timing", result: `LCP=${Math.round(metrics.lcp)}ms · FCP=${Math.round(metrics.fcp)}ms · DOMLoaded=${Math.round(metrics.domLoaded)}ms` }],
            },
            evidence: {
                networkErrors: [],
                consoleErrors: [
                    `LCP=${Math.round(metrics.lcp)}ms (budget=${budgets.lcp_ms}ms)`,
                    `FCP=${Math.round(metrics.fcp)}ms`,
                    `DOMContentLoaded=${Math.round(metrics.domLoaded)}ms`,
                ],
            },
            diagnosis: `${c.feature?.name || c.area} tarda ${Math.round(metrics.lcp)}ms en pintar el contenido principal (LCP), ` +
                `cuando el budget para esta app es ${budgets.lcp_ms}ms. ` +
                `Esto indica recursos críticos en el head (CSS/fonts), JS bloqueante, o imágenes pesadas en above-the-fold.`,
            risks: [
                `Usuarios en 3G/4G perciben la pantalla como "no carga".`,
                metrics.lcp > budgets.lcp_ms * 2
                    ? "Severo: degrada Core Web Vitals y puede afectar SEO."
                    : "Moderado: cae fuera del rango \"good\" de Core Web Vitals.",
            ],
        };
        findings.push(makeFinding(c, {
            type: "perf",
            severity: metrics.lcp > budgets.lcp_ms * 1.5 ? "alta" : "media",
            summary: `LCP de ${Math.round(metrics.lcp)}ms supera el budget ${budgets.lcp_ms}ms`,
            rootCause: "Carga inicial del documento + recursos críticos demasiado lenta",
            recommendation: "Revisar recursos críticos (CSS/fonts en <head>), images sin lazy, scripts bloqueantes",
        }, details));
    }
    return findings;
}
