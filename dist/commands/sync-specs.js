// Comando `qa-cli sync-specs --cwd <proyecto>`
//
// Espeja a la tabla `specs` de D1 las dos fuentes locales del proyecto:
//   - .claude/specs/full-app-matrix.md  (tabla curada de features)
//   - .claude/peticiones-registry.md    (peticiones append-only)
//
// Razón: estos .md viven en la rama git. Si la rama se borra antes de mergear
// (o sin sincronizar), las peticiones se pierden. La fuente de verdad debe ser
// D1 (Cloudflare), accesible desde la página /specs.
//
// El comando es idempotente: por id estable, hace UPSERT. NO sobreescribe el
// state ni el verdict de specs que ya están en D1 con datos de runs.
import fs from "node:fs";
import path from "node:path";
import { SpecsApi } from "../core/specs-api.js";
import { loadEnv } from "../types/config.js";
function readSafe(p) {
    try {
        return fs.readFileSync(p, "utf8");
    }
    catch {
        return "";
    }
}
function slugify(s) {
    return s.toLowerCase()
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60);
}
/** Parser de la tabla markdown `full-app-matrix.md`. Una fila = una feature. */
function parseMatrix(slug, content) {
    const out = [];
    // Buscamos líneas que empiezan con `| F` y tienen ID FXXX. Filtramos cabecera.
    const lines = content.split("\n");
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("|"))
            continue;
        if (trimmed.includes("---"))
            continue; // separador
        const cells = trimmed.split("|").map((c) => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1);
        if (cells.length < 4)
            continue;
        const id = cells[0];
        if (!/^F\d+/.test(id))
            continue;
        const category = cells[1] || "general";
        const name = cells[2] || id;
        const priority = (cells[3] || "").includes("🔴") ? 10 : (cells[3] || "").includes("🟡") ? 30 : 60;
        const views = cells[4] || "";
        const urlMatch = views.match(/`([^`]+)`/);
        const url = urlMatch ? urlMatch[1] : null;
        const interaction = cells[6] || cells[5] || "";
        out.push({
            id: `${slug}-matrix-${id.toLowerCase()}`,
            source: "matrix",
            name: `[${id}] ${name}`,
            description: `Categoría: ${category}. ${interaction}`,
            url,
            qaFlow: null, // matrix no trae qa_flow estructurado todavía
            priority,
        });
    }
    return out;
}
/** Parser del registry markdown. Una sección `## YYYYMMDD-HHMM-slug` = una entrada. */
function parseRegistry(slug, content) {
    const out = [];
    const sections = content.split(/\n## /).slice(1); // primera línea es el header del archivo
    for (const sec of sections) {
        const lines = sec.split("\n");
        const heading = lines[0].trim();
        // Solo entradas que parezcan ID datetime: 8+ dígitos al principio.
        if (!/^\d{8,}/.test(heading))
            continue;
        const idShort = heading.split(/\s+/)[0];
        // Extraer petición y URLs.
        // Capturamos la petición hasta el siguiente campo `- **xxx:**` o el final
        // de la sección. Soporta peticiones multilínea y con comillas internas.
        let petition = "";
        let urlAffected = null;
        const petMatch = sec.match(/\*\*petici[oó]n:\*\*\s*([\s\S]*?)(?=\n-\s+\*\*|\n##\s|$)/i);
        if (petMatch) {
            petition = petMatch[1]
                .trim()
                .replace(/^"|"$/g, "")
                .replace(/\\"/g, '"')
                .replace(/\s+\n/g, "\n")
                .trim();
        }
        const urlMatch = sec.match(/\*\*URLs?\/vistas? afectadas?:\*\*[\s\S]*?-\s+`?([^\n`]+)/i)
            || sec.match(/`(\/[^`]+)`/);
        if (urlMatch)
            urlAffected = urlMatch[1].trim().split(" ")[0];
        // Extraer bloque qa_flow (yaml dentro de ```yaml ... ```).
        let qaFlow = null;
        const yamlMatch = sec.match(/```yaml([\s\S]*?)```/);
        if (yamlMatch) {
            // No parseamos YAML completo (sin dependencia). Lo guardamos crudo en steps[0].notes
            // como referencia humana — el centinela lo ignorará si no hay steps[].
            qaFlow = { rawYaml: yamlMatch[1].trim(), steps: [] };
        }
        // El estado del registry indica prioridad:
        // pendiente-fat-nocturno → priority alta (10).
        // pasada-fat / closed     → priority normal (50).
        const stateMatch = sec.match(/\*\*estado:\*\*\s*([^\n]+)/i);
        const stateText = stateMatch ? stateMatch[1].toLowerCase() : "pendiente";
        const priority = stateText.includes("pendiente") ? 10 : 50;
        // name corto (primera oración o ≤100 chars) para titular la card; la
        // description guarda la petición completa hasta 4000 chars para que la
        // página /specs la muestre entera.
        const firstSentence = petition.split(/(?<=\.)\s+/)[0] || petition;
        const shortName = (firstSentence.length <= 100 ? firstSentence : firstSentence.slice(0, 97) + "…").trim();
        out.push({
            id: `${slug}-registry-${slugify(idShort)}`,
            source: "registry",
            name: shortName || idShort,
            description: petition.slice(0, 4000) || "(sin descripción)",
            url: urlAffected,
            qaFlow,
            priority,
        });
    }
    return out;
}
export async function runSyncSpecs(args) {
    const env = loadEnv();
    const cwd = path.resolve(args.cwd);
    const configPath = path.join(cwd, ".claude", "qa-nocturno.config.json");
    if (!fs.existsSync(configPath))
        throw new Error(`No config en ${configPath}`);
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const matrixContent = readSafe(path.join(cwd, ".claude", "specs", "full-app-matrix.md"));
    const registryContent = readSafe(path.join(cwd, ".claude", "peticiones-registry.md"));
    const entries = [
        ...parseMatrix(config.slug, matrixContent),
        ...parseRegistry(config.slug, registryContent),
    ];
    console.log(`[sync-specs] proyecto=${config.slug} entries=${entries.length} (matrix=${parseMatrix(config.slug, matrixContent).length} registry=${parseRegistry(config.slug, registryContent).length})`);
    if (args.dryRun) {
        for (const e of entries.slice(0, 5))
            console.log(`  ${e.id} :: ${e.name}`);
        return;
    }
    const specsApi = new SpecsApi(env);
    // Lee lo que ya hay para preservar state/verdict de specs ya probadas.
    const existing = await specsApi.list({ project: config.slug });
    const existingMap = new Map(existing.map((s) => [s.id, s]));
    let inserted = 0, skipped = 0;
    for (const e of entries) {
        const prev = existingMap.get(e.id);
        const spec = {
            id: e.id,
            projectSlug: config.slug,
            source: e.source,
            name: e.name,
            description: e.description,
            url: e.url || undefined,
            qaFlow: e.qaFlow,
            priority: e.priority,
            // Si ya existía con verdict, preservamos su estado actual; sino, pending.
            state: prev?.lastVerdict ? prev.state : "pending",
            createdBy: e.source + "-import",
        };
        await specsApi.upsert(spec);
        inserted++;
        if (inserted % 10 === 0)
            console.log(`  ${inserted}/${entries.length}...`);
    }
    console.log(`[sync-specs] done. upserted=${inserted} skipped=${skipped}`);
}
