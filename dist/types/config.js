export function loadEnv() {
    const required = [
        "ANTHROPIC_API_KEY", "BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID",
        "QA_USER_EMAIL", "QA_USER_PASSWORD",
        "QA_VELZIA_API_URL", "QA_VELZIA_API_TOKEN",
    ];
    for (const k of required) {
        if (!process.env[k])
            throw new Error(`Missing env var: ${k}`);
    }
    return {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        BROWSERBASE_API_KEY: process.env.BROWSERBASE_API_KEY,
        BROWSERBASE_PROJECT_ID: process.env.BROWSERBASE_PROJECT_ID,
        QA_USER_EMAIL: process.env.QA_USER_EMAIL,
        QA_USER_PASSWORD: process.env.QA_USER_PASSWORD,
        QA_USER_TENANT_ID: process.env.QA_USER_TENANT_ID || "",
        QA_USER_PROJECT_ID: process.env.QA_USER_PROJECT_ID || "",
        QA_CLIENT_EMAIL: process.env.QA_CLIENT_EMAIL || "",
        QA_CLIENT_PHONE: process.env.QA_CLIENT_PHONE || "",
        QA_VELZIA_API_URL: process.env.QA_VELZIA_API_URL,
        QA_VELZIA_API_TOKEN: process.env.QA_VELZIA_API_TOKEN,
        GITHUB_TOKEN: process.env.GITHUB_TOKEN,
        RUN_ID: process.env.RUN_ID,
    };
}
