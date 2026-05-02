export interface QaConfig {
  appName: string;
  slug: string;
  urls: { prod: string; local?: string };
  loginPath: string | null;
  afterLoginPath: string;
  readinessSelector: string;
  envVars: { email: string; password: string; tenantId?: string; uuid?: string };
  viewport: { width: number; height: number };
  engine: { type: "playwright" | "stagehand-local" | "browserbase"; parallel?: number };
  coverageMode: "exhaustive" | "incremental" | "hybrid";
  mobileFirst?: boolean;
  perfBudgets?: {
    lcp_ms: number;
    cls: number;
    tbt_ms: number;
    score_min: number;
  };
  exclusions?: string[];
}

export interface RuntimeEnv {
  // Cliente Anthropic
  ANTHROPIC_API_KEY: string;
  // Cliente Browserbase
  BROWSERBASE_API_KEY: string;
  BROWSERBASE_PROJECT_ID: string;
  // Login QA
  QA_USER_EMAIL: string;
  QA_USER_PASSWORD: string;
  QA_USER_TENANT_ID: string;
  QA_USER_PROJECT_ID: string;
  QA_CLIENT_EMAIL: string;
  QA_CLIENT_PHONE: string;
  // Cloudflare Worker (cliente API)
  QA_VELZIA_API_URL: string;
  QA_VELZIA_API_TOKEN: string;
  // GitHub
  GITHUB_TOKEN?: string;
  // Run
  RUN_ID?: string;
}

export function loadEnv(): RuntimeEnv {
  const required = [
    "ANTHROPIC_API_KEY", "BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID",
    "QA_USER_EMAIL", "QA_USER_PASSWORD",
    "QA_VELZIA_API_URL", "QA_VELZIA_API_TOKEN",
  ];
  for (const k of required) {
    if (!process.env[k]) throw new Error(`Missing env var: ${k}`);
  }
  return {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
    BROWSERBASE_API_KEY: process.env.BROWSERBASE_API_KEY!,
    BROWSERBASE_PROJECT_ID: process.env.BROWSERBASE_PROJECT_ID!,
    QA_USER_EMAIL: process.env.QA_USER_EMAIL!,
    QA_USER_PASSWORD: process.env.QA_USER_PASSWORD!,
    QA_USER_TENANT_ID: process.env.QA_USER_TENANT_ID || "",
    QA_USER_PROJECT_ID: process.env.QA_USER_PROJECT_ID || "",
    QA_CLIENT_EMAIL: process.env.QA_CLIENT_EMAIL || "",
    QA_CLIENT_PHONE: process.env.QA_CLIENT_PHONE || "",
    QA_VELZIA_API_URL: process.env.QA_VELZIA_API_URL!,
    QA_VELZIA_API_TOKEN: process.env.QA_VELZIA_API_TOKEN!,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    RUN_ID: process.env.RUN_ID,
  };
}
