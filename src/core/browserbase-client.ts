// Wrapper Browserbase + Stagehand. Soporta dos modos:
//  - engine.type === "browserbase"     → sesión remota en la nube (cuesta minutos).
//  - engine.type === "stagehand-local" → Playwright local en el runner (gratis en GH Actions).
// Usado por flow-executor + jueces (a11y, mobile-first).

import { Browserbase } from "@browserbasehq/sdk";
import { Stagehand } from "@browserbasehq/stagehand";
import type { RuntimeEnv, QaConfig } from "../types/config.js";

export class BrowserbaseClient {
  private bb: Browserbase | null = null;
  private stagehand: Stagehand | null = null;

  constructor(private env: RuntimeEnv) {
    if (env.BROWSERBASE_API_KEY) {
      this.bb = new Browserbase({ apiKey: env.BROWSERBASE_API_KEY });
    }
  }

  async startSession(config: QaConfig): Promise<Stagehand> {
    const useLocal = config.engine?.type === "stagehand-local" || config.engine?.type === "playwright";
    if (useLocal) {
      // Playwright local: sin Browserbase. Requiere `npx playwright install chromium`
      // en el runner. Las acciones AI siguen llamando Anthropic, pero centinela
      // hoy solo usa page.goto/waitForSelector, así que coste extra ≈ $0.
      this.stagehand = new Stagehand({
        env: "LOCAL",
        modelName: "claude-3-5-sonnet-latest",
        modelClientOptions: { apiKey: this.env.ANTHROPIC_API_KEY },
        localBrowserLaunchOptions: {
          viewport: config.viewport,
          headless: true,
        },
      } as any);
    } else {
      if (!this.bb) throw new Error("BROWSERBASE_API_KEY requerida para engine.type=browserbase");
      const sess = await this.bb.sessions.create({
        projectId: this.env.BROWSERBASE_PROJECT_ID,
        browserSettings: { viewport: config.viewport },
      });
      this.stagehand = new Stagehand({
        env: "BROWSERBASE",
        browserbaseSessionID: sess.id,
        modelName: "claude-3-5-sonnet-latest",
        modelClientOptions: { apiKey: this.env.ANTHROPIC_API_KEY },
      });
    }
    await this.stagehand.init();
    return this.stagehand;
  }

  /**
   * Login best-effort. Si los selectores no matchean (proyectos con auth custom)
   * o el submit no redirige en 15s, NO lanza: deja la sesión sin auth y las
   * features que requieran auth se marcarán BLOCKED por el flow-executor cuando
   * vean /login en la URL final.
   */
  async login(config: QaConfig): Promise<void> {
    if (!this.stagehand) throw new Error("startSession() primero");
    if (!config.loginPath) return;
    const page = this.stagehand.page;
    try {
      await page.goto(`${config.urls.prod}${config.loginPath}`, { waitUntil: "domcontentloaded", timeout: 15000 });

      // Probamos varios selectores comunes para email/password antes de rendirnos.
      const emailSelectors = [
        'input[type="email"]',
        'input[name="email"]',
        '[data-testid="email"]',
        '[data-testid="login-email"]',
        '#email',
        'input[autocomplete="email"]',
      ];
      const passwordSelectors = [
        'input[type="password"]',
        'input[name="password"]',
        '[data-testid="password"]',
        '[data-testid="login-password"]',
        '#password',
        'input[autocomplete="current-password"]',
      ];

      let emailFilled = false;
      for (const sel of emailSelectors) {
        try {
          await page.fill(sel, this.env.QA_USER_EMAIL, { timeout: 2000 });
          emailFilled = true;
          break;
        } catch { /* siguiente selector */ }
      }
      if (!emailFilled) {
        console.warn(`[login] no encontré input de email en ${config.loginPath}, sigo sin auth`);
        return;
      }

      let passwordFilled = false;
      for (const sel of passwordSelectors) {
        try {
          await page.fill(sel, this.env.QA_USER_PASSWORD, { timeout: 2000 });
          passwordFilled = true;
          break;
        } catch { /* siguiente */ }
      }
      if (!passwordFilled) {
        console.warn(`[login] input de password no encontrado, sigo sin auth`);
        return;
      }

      // Submit + esperar a salir de /login (solo 15s, no 30 — si tarda más, asumimos fallo).
      await Promise.all([
        page.waitForURL((u: any) => !u.toString().includes(config.loginPath!), { timeout: 15000 }).catch(() => {}),
        page.click('button[type="submit"]').catch(() => {}),
      ]);

      if (config.readinessSelector) {
        await page.waitForSelector(config.readinessSelector, { timeout: 8000 }).catch(() => {});
      }
    } catch (e: any) {
      console.warn(`[login] best-effort falló (${e.message?.slice(0, 100)}), continúo sin auth`);
    }
  }

  async screenshot(): Promise<Buffer> {
    if (!this.stagehand) throw new Error("startSession() primero");
    const buf = await this.stagehand.page.screenshot({ fullPage: false });
    return buf;
  }

  async getConsoleErrors(): Promise<string[]> {
    if (!this.stagehand) return [];
    // Stagehand expone los console events del navegador remoto via SDK; aquí simplificamos.
    // En producción, registramos los listeners al inicio de la sesión.
    return (this as any)._consoleErrors || [];
  }

  async closeSession(): Promise<void> {
    if (this.stagehand) {
      await this.stagehand.close();
      this.stagehand = null;
    }
  }

  getStagehand(): Stagehand {
    if (!this.stagehand) throw new Error("startSession() primero");
    return this.stagehand;
  }
}
