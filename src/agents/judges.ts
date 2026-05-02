// 6 jueces de lente humana — invocados por Centinela tras cada PASS funcional.
// ux-heuristic, microcopy, legibility, mobile-first, a11y (axe), perf (Lighthouse).

import type { AnthropicClient } from "../core/anthropic-client.js";
import type { BrowserbaseClient } from "../core/browserbase-client.js";
import type { Finding, FindingType, Severity } from "../types/finding.js";
import type { QaConfig } from "../types/config.js";
import { makeFindingId } from "../core/findings-api.js";

interface JudgeContext {
  client: AnthropicClient;
  browser: BrowserbaseClient;
  config: QaConfig;
  area: string; // URL/ruta evaluada
  runId: string;
  snapshot?: string;
  screenshotBase64?: string;
}

interface AgentJudgeOutput {
  findings: Array<{
    type: FindingType;
    severity: Severity;
    summary: string;
    rootCause: string;
    recommendation: string;
  }>;
}

function makeFinding(c: JudgeContext, raw: AgentJudgeOutput["findings"][0]): Finding {
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
  };
}

// 4.1 — UX heuristic (Sonnet)
export async function uxHeuristicJudge(c: JudgeContext): Promise<Finding[]> {
  const r = await c.client.invoke({
    model: "claude-sonnet-4-6",
    staticPrefix: `Eres experto UX siguiendo las 10 heurísticas de Nielsen + reglas CLAUDE.md (UI autoexplicativa, PageHelp obligatorio, selects buscables, tabs sincronizados con URL, microcopy claro).`,
    dynamicSuffix: `Snapshot de la vista ${c.area}:\n${c.snapshot?.slice(0, 8000) || "(sin snapshot)"}\n\nDevuelve JSON: { "findings": [{ "type":"ux-debt", "severity":"alta|media|baja", "summary":"...", "rootCause":"...", "recommendation":"..." }] }. Si no hay nada problemático: {"findings":[]}.`,
    maxTokens: 2048,
  });
  const out = c.client.parseJson<AgentJudgeOutput>(r.text);
  return (out.findings || []).map((f) => makeFinding(c, f));
}

// 4.2 — Microcopy (Sonnet)
export async function microcopyJudge(c: JudgeContext): Promise<Finding[]> {
  const r = await c.client.invoke({
    model: "claude-sonnet-4-6",
    staticPrefix: `Eres copywriter UX. Revisa labels confusas, jerga técnica visible (tenant_id, uuid, API), ortografía (acentos español), botones genéricos sin contexto, placeholders vacíos, errores sin solución, estados vacíos sin instrucción, tooltips ausentes.`,
    dynamicSuffix: `Snapshot ${c.area}:\n${c.snapshot?.slice(0, 6000) || ""}\n\nJSON: { "findings": [{ "type":"ux-debt", "severity":"...", "summary":"...", "rootCause":"...", "recommendation":"..." }] }`,
    maxTokens: 1500,
  });
  const out = c.client.parseJson<AgentJudgeOutput>(r.text);
  return (out.findings || []).map((f) => makeFinding(c, f));
}

// 4.3.5 — Legibility (Haiku) — F nuevo Chany 2026-05-02
export async function legibilityJudge(c: JudgeContext): Promise<Finding[]> {
  const r = await c.client.invoke({
    model: "claude-haiku-4-5-20251001",
    staticPrefix: `Eres experto en tipografía web. Detecta: tamaño body <14px desktop o <16px mobile, contraste WCAG AA <4.5:1, líneas >80 chars, line-height <1.4, MAYÚSCULAS excesivas, serif para body, tipografías sin distinción 0/O/I/l/1.`,
    dynamicSuffix: `Snapshot ${c.area}:\n${c.snapshot?.slice(0, 4000) || ""}\n\nJSON con findings type:"ux-debt".`,
    maxTokens: 1500,
  });
  const out = c.client.parseJson<AgentJudgeOutput>(r.text);
  return (out.findings || []).map((f) => makeFinding(c, f));
}

// 4.3.6 — Mobile-first (Sonnet) — solo si config.mobileFirst===true. F nuevo Chany.
export async function mobileFirstJudge(c: JudgeContext): Promise<Finding[]> {
  if (!c.config.mobileFirst) return [];
  // Re-render en viewport 375x667.
  const stagehand = c.browser.getStagehand();
  await stagehand.page.setViewportSize({ width: 375, height: 667 }).catch(() => {});
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
  await stagehand.page.setViewportSize(c.config.viewport).catch(() => {});
  const out = c.client.parseJson<AgentJudgeOutput>(r.text);
  return (out.findings || []).map((f) => makeFinding(c, f));
}

// 4.3 — A11y (Haiku) con axe-core inyectado.
export async function a11yJudge(c: JudgeContext): Promise<Finding[]> {
  const stagehand = c.browser.getStagehand();
  const result = await stagehand.page.evaluate(async () => {
    if (!(window as any).axe) {
      await new Promise<void>((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.0/axe.min.js";
        s.onload = () => resolve();
        s.onerror = () => reject();
        document.head.appendChild(s);
      });
    }
    const r = await (window as any).axe.run();
    return {
      violations: r.violations.map((v: any) => ({ id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, count: v.nodes.length })),
    };
  }).catch(() => ({ violations: [] }));

  const sevMap: Record<string, Severity> = { critical: "critica", serious: "alta", moderate: "media", minor: "baja" };
  return (result.violations || []).map((v: any): Finding => {
    const summary = `[a11y/${v.id}] ${v.help} (${v.count} nodos)`;
    return makeFinding(c, {
      type: "a11y",
      severity: sevMap[v.impact] || "baja",
      summary,
      rootCause: `axe-core regla "${v.id}" detecta ${v.count} violaciones`,
      recommendation: `Doc: ${v.helpUrl}`,
    });
  });
}

// 4.4 — Perf (determinista) con Lighthouse-CI.
// Requiere chrome-launcher disponible — en GH Actions con Playwright lo tenemos.
export async function perfJudge(c: JudgeContext): Promise<Finding[]> {
  const budgets = c.config.perfBudgets;
  if (!budgets) return [];
  // Por simplicidad (Lighthouse en Browserbase requiere CDP custom), aquí emitimos
  // findings basados en métricas que el page.evaluate puede dar via Performance API.
  const stagehand = c.browser.getStagehand();
  const metrics = await stagehand.page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as any;
    const paint = performance.getEntriesByName("first-contentful-paint")[0] as any;
    return {
      lcp: nav ? nav.loadEventEnd - nav.fetchStart : 0,
      fcp: paint ? paint.startTime : 0,
      domLoaded: nav ? nav.domContentLoadedEventEnd - nav.fetchStart : 0,
    };
  }).catch(() => ({ lcp: 0, fcp: 0, domLoaded: 0 }));

  const findings: Finding[] = [];
  if (metrics.lcp > budgets.lcp_ms) {
    findings.push(makeFinding(c, {
      type: "perf",
      severity: metrics.lcp > budgets.lcp_ms * 1.5 ? "alta" : "media",
      summary: `LCP de ${Math.round(metrics.lcp)}ms supera el budget ${budgets.lcp_ms}ms`,
      rootCause: "Carga inicial del documento + recursos críticos demasiado lenta",
      recommendation: "Revisar recursos críticos (CSS/fonts en <head>), images sin lazy, scripts bloqueantes",
    }));
  }
  return findings;
}
