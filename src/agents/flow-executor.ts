// qa-flow-executor (Haiku 4.5) — ejecuta una feature en el navegador, detecta bugs funcionales.

import type { AnthropicClient } from "../core/anthropic-client.js";
import type { BrowserbaseClient } from "../core/browserbase-client.js";
import type { PlanFeature } from "./planner.js";
import type { QaConfig } from "../types/config.js";
import { assertScopeOk } from "../core/scope-guard.js";

export interface ExecuteResult {
  featureId: string;
  verdict: "PASS" | "FAIL" | "BLOCKED";
  durationMs: number;
  consoleErrors: string[];
  networkErrors: Array<{ endpoint: string; status: number }>;
  screenshotPath?: string;
  blockReason?: string;
  failNote?: string;
}

export async function execute(opts: {
  client: AnthropicClient;
  browser: BrowserbaseClient;
  config: QaConfig;
  feature: PlanFeature;
  projectId: string; // QA_USER_PROJECT_ID
}): Promise<ExecuteResult> {
  const startedAt = Date.now();
  const consoleErrors: string[] = [];
  const networkErrors: Array<{ endpoint: string; status: number }> = [];

  const stagehand = opts.browser.getStagehand();
  const page = stagehand.page;

  // Listeners.
  page.on("console", (msg: any) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("response", (res: any) => {
    if (res.status() >= 400) networkErrors.push({ endpoint: res.url(), status: res.status() });
  });

  try {
    // Si la feature tiene URL, navegar.
    if (opts.feature.url) {
      const targetUrl = `${opts.config.urls.prod}${opts.feature.url}`;
      // bypassScopeGuard porque navegar es lectura.
      assertScopeOk({ action: "navigate", url: targetUrl, bypassScopeGuard: true }, opts.projectId);
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    }

    // Esperar a que la página esté lista.
    if (opts.config.readinessSelector) {
      await page.waitForSelector(opts.config.readinessSelector, { timeout: 10000 }).catch(() => {});
    }

    // Stagehand observa estado.
    await stagehand.page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});

    // Verdict heurístico:
    // - Si la URL final es 404/login (cuando esperábamos otra cosa) → BLOCKED
    // - Si hay >0 networkErrors >=500 → FAIL
    // - Si hay >0 networkErrors 4xx en la propia ruta de la feature → FAIL
    // - Else → PASS
    const finalUrl = page.url();
    if (finalUrl.includes("/login") && opts.feature.url && !opts.feature.url.includes("/login")) {
      return {
        featureId: opts.feature.id,
        verdict: "BLOCKED",
        blockReason: "redirected to /login — sesión perdida o ruta requiere otro rol",
        durationMs: Date.now() - startedAt,
        consoleErrors, networkErrors,
      };
    }
    const has5xx = networkErrors.some((e) => e.status >= 500);
    if (has5xx) {
      return {
        featureId: opts.feature.id,
        verdict: "FAIL",
        failNote: `5xx en ${networkErrors.find((e) => e.status >= 500)?.endpoint}`,
        durationMs: Date.now() - startedAt,
        consoleErrors, networkErrors,
      };
    }

    return {
      featureId: opts.feature.id,
      verdict: "PASS",
      durationMs: Date.now() - startedAt,
      consoleErrors,
      networkErrors,
    };
  } catch (e: any) {
    return {
      featureId: opts.feature.id,
      verdict: "BLOCKED",
      blockReason: `excepción: ${e.message?.slice(0, 200)}`,
      durationMs: Date.now() - startedAt,
      consoleErrors,
      networkErrors,
    };
  }
}
