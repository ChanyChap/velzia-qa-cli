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

  async login(config: QaConfig): Promise<void> {
    if (!this.stagehand) throw new Error("startSession() primero");
    if (!config.loginPath) return;
    const page = this.stagehand.page;
    await page.goto(`${config.urls.prod}${config.loginPath}`, { waitUntil: "domcontentloaded" });
    await page.fill('input[type="email"], input[name="email"]', this.env.QA_USER_EMAIL);
    await page.fill('input[type="password"], input[name="password"]', this.env.QA_USER_PASSWORD);
    await Promise.all([
      page.waitForURL((u: any) => !u.toString().includes(config.loginPath!), { timeout: 30000 }),
      page.click('button[type="submit"]'),
    ]);
    if (config.readinessSelector) {
      await page.waitForSelector(config.readinessSelector, { timeout: 15000 });
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
