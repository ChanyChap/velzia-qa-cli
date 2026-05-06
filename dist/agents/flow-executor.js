// qa-flow-executor (Haiku 4.5) — ejecuta una feature en el navegador, detecta bugs funcionales.
import { assertScopeOk } from "../core/scope-guard.js";
export async function execute(opts) {
    const startedAt = Date.now();
    const consoleErrors = [];
    const networkErrors = [];
    const stepsExecuted = [];
    const stagehand = opts.browser.getStagehand();
    const page = stagehand.page;
    // Listeners.
    page.on("console", (msg) => { if (msg.type() === "error")
        consoleErrors.push(msg.text()); });
    page.on("response", (res) => {
        if (res.status() >= 400) {
            networkErrors.push({
                endpoint: res.url(),
                status: res.status(),
                method: res.request?.()?.method?.() || undefined,
            });
        }
    });
    try {
        // Si la feature tiene URL, navegar.
        if (opts.feature.url) {
            const targetUrl = `${opts.config.urls.prod}${opts.feature.url}`;
            // bypassScopeGuard porque navegar es lectura.
            assertScopeOk({ action: "navigate", url: targetUrl, bypassScopeGuard: true }, opts.projectId);
            const navStart = Date.now();
            await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
            stepsExecuted.push({
                action: "navigate",
                selector: targetUrl,
                result: "DOM cargado",
                durationMs: Date.now() - navStart,
            });
        }
        // Esperar a que la página esté lista.
        if (opts.config.readinessSelector) {
            const waitStart = Date.now();
            let result = "encontrado";
            await page
                .waitForSelector(opts.config.readinessSelector, { timeout: 10000 })
                .catch(() => { result = "timeout (10s)"; });
            stepsExecuted.push({
                action: "wait",
                selector: opts.config.readinessSelector,
                result,
                durationMs: Date.now() - waitStart,
            });
        }
        // Stagehand observa estado de red.
        const idleStart = Date.now();
        let idleResult = "networkidle alcanzado";
        await stagehand.page
            .waitForLoadState("networkidle", { timeout: 5000 })
            .catch(() => { idleResult = "timeout (5s) — red sigue activa"; });
        stepsExecuted.push({
            action: "wait",
            selector: "networkidle",
            result: idleResult,
            durationMs: Date.now() - idleStart,
        });
        // Verdict heurístico:
        // - Si la URL final es 404/login (cuando esperábamos otra cosa) → BLOCKED
        // - Si hay >0 networkErrors >=500 → FAIL
        // - Else → PASS (los 6 jueces decidirán si hay deuda visual/UX)
        const finalUrl = page.url();
        if (finalUrl.includes("/login") && opts.feature.url && !opts.feature.url.includes("/login")) {
            return {
                featureId: opts.feature.id,
                verdict: "BLOCKED",
                blockReason: "redirected to /login — sesión perdida o ruta requiere otro rol",
                durationMs: Date.now() - startedAt,
                consoleErrors, networkErrors, stepsExecuted, finalUrl,
            };
        }
        const has5xx = networkErrors.some((e) => e.status >= 500);
        if (has5xx) {
            return {
                featureId: opts.feature.id,
                verdict: "FAIL",
                failNote: `5xx en ${networkErrors.find((e) => e.status >= 500)?.endpoint}`,
                durationMs: Date.now() - startedAt,
                consoleErrors, networkErrors, stepsExecuted, finalUrl,
            };
        }
        return {
            featureId: opts.feature.id,
            verdict: "PASS",
            durationMs: Date.now() - startedAt,
            consoleErrors,
            networkErrors,
            stepsExecuted,
            finalUrl,
        };
    }
    catch (e) {
        return {
            featureId: opts.feature.id,
            verdict: "BLOCKED",
            blockReason: `excepción: ${e.message?.slice(0, 200)}`,
            durationMs: Date.now() - startedAt,
            consoleErrors,
            networkErrors,
            stepsExecuted,
        };
    }
}
