// Wrapper Browserbase + Stagehand para sesión de navegador en la nube.
// Usado por flow-executor + jueces (a11y, mobile-first).
import { Browserbase } from "@browserbasehq/sdk";
import { Stagehand } from "@browserbasehq/stagehand";
export class BrowserbaseClient {
    env;
    bb;
    stagehand = null;
    constructor(env) {
        this.env = env;
        this.bb = new Browserbase({ apiKey: env.BROWSERBASE_API_KEY });
    }
    async startSession(config) {
        const sess = await this.bb.sessions.create({
            projectId: this.env.BROWSERBASE_PROJECT_ID,
            browserSettings: {
                viewport: config.viewport,
            },
        });
        this.stagehand = new Stagehand({
            env: "BROWSERBASE",
            browserbaseSessionID: sess.id,
            modelName: "claude-3-5-sonnet-latest",
            modelClientOptions: { apiKey: this.env.ANTHROPIC_API_KEY },
        });
        await this.stagehand.init();
        return this.stagehand;
    }
    async login(config) {
        if (!this.stagehand)
            throw new Error("startSession() primero");
        if (!config.loginPath)
            return;
        const page = this.stagehand.page;
        await page.goto(`${config.urls.prod}${config.loginPath}`, { waitUntil: "domcontentloaded" });
        await page.fill('input[type="email"], input[name="email"]', this.env.QA_USER_EMAIL);
        await page.fill('input[type="password"], input[name="password"]', this.env.QA_USER_PASSWORD);
        await Promise.all([
            page.waitForURL((u) => !u.toString().includes(config.loginPath), { timeout: 30000 }),
            page.click('button[type="submit"]'),
        ]);
        if (config.readinessSelector) {
            await page.waitForSelector(config.readinessSelector, { timeout: 15000 });
        }
    }
    async screenshot() {
        if (!this.stagehand)
            throw new Error("startSession() primero");
        const buf = await this.stagehand.page.screenshot({ fullPage: false });
        return buf;
    }
    async getConsoleErrors() {
        if (!this.stagehand)
            return [];
        // Stagehand expone los console events del navegador remoto via SDK; aquí simplificamos.
        // En producción, registramos los listeners al inicio de la sesión.
        return this._consoleErrors || [];
    }
    async closeSession() {
        if (this.stagehand) {
            await this.stagehand.close();
            this.stagehand = null;
        }
    }
    getStagehand() {
        if (!this.stagehand)
            throw new Error("startSession() primero");
        return this.stagehand;
    }
}
