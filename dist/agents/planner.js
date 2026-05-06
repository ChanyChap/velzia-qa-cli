// qa-planner (Sonnet 4.6) — resuelve el cover del run.
export async function plan(opts) {
    const staticPrefix = [
        `# Project config: ${opts.config.appName} (${opts.config.slug})`,
        `URL: ${opts.config.urls.prod}`,
        `Engine: ${opts.config.engine.type} parallel=${opts.config.engine.parallel || 1}`,
        `Mobile-first: ${opts.config.mobileFirst ? "yes" : "no"}`,
        "",
        "## Matrix curada:",
        opts.matrixContent.slice(0, 8000),
        "",
        "## Registry pendiente:",
        opts.registryContent.slice(0, 8000),
        "",
        "## Domain assumptions:",
        opts.domainContent.slice(0, 4000),
    ].join("\n");
    const dynamicSuffix = `Modo del run: ${opts.mode}
${opts.diffFiles?.length ? `Archivos cambiados en este push:\n${opts.diffFiles.join("\n")}\n` : ""}

Resuelve el cover de features a probar esta sesión. Devuelve JSON ESTRICTO:

{
  "project": "${opts.config.slug}",
  "totalFeatures": N,
  "estimatedDurationMin": N,
  "batches": [
    {
      "name": "batch-1-auth",
      "parallel": 1,
      "features": [
        { "id": "F001", "name": "Login", "source": "matrix", "qaFlowAvailable": true, "criticality": "critica", "estimatedSec": 45, "url": "/login" }
      ],
      "rationale": "..."
    }
  ],
  "skipped": [{ "id": "...", "reason": "exclusion: ..." }]
}

Reglas:
- En "smoke" → max 10 features marcadas critica.
- En "diff-cover" → solo features que tocan archivos del diff.
- En "full" → todo lo no excluido.
- En "regression-only" → solo entries con prefix "regresion-" en registry.

Aplica exclusions del config: ${JSON.stringify(opts.config.exclusions || [])}.

Respuesta solo JSON, sin texto explicativo.`;
    const r = await opts.client.invoke({
        model: "claude-sonnet-4-6",
        staticPrefix,
        dynamicSuffix,
        maxTokens: 16384,
        includeDefenseBlocks: true,
    });
    return opts.client.parseJson(r.text);
}
