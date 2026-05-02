# @velzia/qa-cli

CLI ejecutado por GitHub Actions cron para Centinela + Sastre. Sin invocación manual de Chany.

## Comandos

```bash
qa-cli centinela --mode full|smoke|diff-cover [--diff-files a.ts,b.ts]
qa-cli sastre [--dry-run]
qa-cli version
```

## Variables de entorno requeridas

```
ANTHROPIC_API_KEY       — para los agentes
BROWSERBASE_API_KEY     — sesión browser remota
BROWSERBASE_PROJECT_ID
QA_USER_EMAIL           — login QA
QA_USER_PASSWORD
QA_USER_TENANT_ID       — bb4bd5e7-3593-4594-902f-80ba871ea4d5
QA_USER_PROJECT_ID      — c5461108-357d-4956-8275-459fd2ddfc71 (scope-guard)
QA_CLIENT_EMAIL         — chany@velzia.com (para simular cliente)
QA_CLIENT_PHONE
QA_VELZIA_API_URL       — https://qa.velzia.com
QA_VELZIA_API_TOKEN     — Bearer del Worker
GITHUB_TOKEN            — solo en sastre, para `gh pr create`
RUN_ID                  — opcional, para tracking en /api/runs
```

## Build & test local

```bash
cd ~/.claude/scripts/qa-cli
npm install
npm run build
node dist/cli.js version
```

## Publicar como paquete privado

Cuando esté estable, publicar en npm privado o GitHub Packages:

```bash
npm publish --access restricted
# O subir a GitHub Packages:
# echo "@velzia:registry=https://npm.pkg.github.com" >> ~/.npmrc
# npm publish
```

Los workflows ya invocan `npm install -g @velzia/qa-cli@latest` — al publicar la primera versión, los crons funcionan automáticamente desde la noche siguiente.

## Arquitectura

```
src/
├── cli.ts                       Entry point
├── commands/
│   ├── centinela.ts             Orchestador del run de descubrimiento
│   └── sastre.ts                Aplicador con retry-5 + auto-PR
├── agents/
│   ├── planner.ts               qa-planner (Sonnet) → cover plan
│   ├── flow-executor.ts         qa-flow-executor (browser real) → veredicto
│   └── judges.ts                6 jueces lente humana (UX/microcopy/legibility/mobile/a11y/perf)
├── core/
│   ├── anthropic-client.ts      Wrapper SDK con prompt-caching ephemeral
│   ├── browserbase-client.ts    Sesión Stagehand+Browserbase
│   ├── findings-api.ts          HTTP client al Worker Cloudflare
│   └── scope-guard.ts           Bloquea mutaciones fuera del proyecto Chany
└── types/
    ├── finding.ts               Schema TS del finding
    └── config.ts                QaConfig, RuntimeEnv, loadEnv()
```

## Defensas integradas

- **F0.5 Prompt-injection defense**: bloque defensivo en TODO prompt a Anthropic.
- **F2 Scope-guard**: `assertScopeOk()` antes de cada acción mutante.
- **F8 Prompt caching**: prefijo estático con `cache_control: ephemeral` → -30-40% input cost.

## Coste por run nocturno

Estimación con prompt caching y modelos optimizados:
- Centinela full-cover: ~50-100 features × 6 jueces × Haiku/Sonnet con cache → ~$0.50-1.50/run
- Sastre: solo si hay findings approved → ~$0.10-0.30/run
- **Total noche**: ~$0.60-1.80 = **~25 €/mes**.
