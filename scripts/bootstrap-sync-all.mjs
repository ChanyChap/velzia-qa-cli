// Bootstrap one-shot: sincroniza la matrix + registry de los 4 proyectos
// reales de Chany a la tabla `specs` de D1.
//
// Usa HMAC token (no requiere QA_VELZIA_API_TOKEN). Idempotente: por id
// estable hace UPSERT. Preserva state/verdict de specs ya probadas.

import fs from "node:fs";
import path from "node:path";

const API = "https://qa-velzia.chany-velzia.workers.dev";
const TOKEN = "eyJzdWIiOiJjaGFueSIsImV4cCI6MTc4NTk0Nzk3MDM3NH0.02_CzhqTW_tLSYKBWa4SMe57W63moEVtFbaQmz2t_Ag";

const projects = [
  { slug: "rt.sig", path: "C:\\Users\\Chany Chapnik\\Documents\\Claude\\rt.sig" },
  { slug: "factorias", path: "C:\\Users\\Chany Chapnik\\Documents\\Claude\\Factorias" },
  { slug: "velziaonsite", path: "C:\\Users\\Chany Chapnik\\Documents\\Claude\\velziaonsite" },
  { slug: "velziacad", path: "C:\\Users\\Chany Chapnik\\Documents\\Claude\\velziacad" },
];

function readSafe(p) {
  try { return fs.readFileSync(p, "utf8"); } catch { return ""; }
}

function slugify(s) {
  return String(s).toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function parseMatrix(slug, content) {
  const out = [];
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("|")) continue;
    if (t.includes("---")) continue;
    const cells = t.split("|").map(c => c.trim()).slice(1, -1);
    if (cells.length < 4) continue;
    const id = cells[0];
    if (!/^F\d+/.test(id)) continue;
    const category = cells[1] || "general";
    const name = cells[2] || id;
    const prio = cells[3] || "";
    const priority = prio.includes("🔴") ? 10 : prio.includes("🟡") ? 30 : 60;
    const views = cells[4] || "";
    const um = views.match(/`([^`]+)`/);
    const url = um ? um[1] : null;
    const interaction = cells[6] || cells[5] || "";
    out.push({
      id: `${slug}-matrix-${id.toLowerCase()}`,
      source: "matrix",
      name: `[${id}] ${name}`,
      description: `Categoría: ${category}. ${interaction}`.slice(0, 400),
      url,
      priority,
    });
  }
  return out;
}

function parseRegistry(slug, content) {
  const out = [];
  const sections = content.split(/\n## /).slice(1);
  for (const sec of sections) {
    const lines = sec.split("\n");
    const heading = lines[0].trim();
    if (!/^\d{8,}/.test(heading)) continue;
    const idShort = heading.split(/\s+/)[0];

    // Capturamos la petición hasta el siguiente campo `- **xxx:**` o el final
    // de la sección. Antes paraba al ver la primera comilla, lo que truncaba
    // peticiones con citas dentro (ej: `card \"Empresa\"...`).
    let petition = "";
    const petMatch = sec.match(/\*\*petici[oó]n:\*\*\s*([\s\S]*?)(?=\n-\s+\*\*|\n##\s|$)/i);
    if (petMatch) {
      petition = petMatch[1]
        .trim()
        .replace(/^"|"$/g, "")          // comillas externas que envuelven la cita
        .replace(/\\"/g, '"')            // \" → " (desescape)
        .replace(/\s+\n/g, "\n")         // limpia espacios al final de líneas
        .trim();
    }

    let urlAffected = null;
    const urlBlock = sec.match(/\*\*URLs?\/vistas? afectadas?:\*\*([\s\S]*?)(\n-\s+\*\*|\n\n|$)/i);
    if (urlBlock) {
      const m = urlBlock[1].match(/`?(\/[^\s`\n→]+)/);
      if (m) urlAffected = m[1];
    }

    const yamlMatch = sec.match(/```yaml([\s\S]*?)```/);
    const qaFlow = yamlMatch ? { rawYaml: yamlMatch[1].trim().slice(0, 4000), steps: [] } : null;

    const stateMatch = sec.match(/\*\*estado:\*\*\s*([^\n]+)/i);
    const stateText = stateMatch ? stateMatch[1].toLowerCase() : "pendiente";
    const priority = stateText.includes("pendiente") ? 10 : 50;

    // El name debe ser corto para titular la card. Cogemos la primera oración o
    // los primeros 100 chars hasta el primer punto. La description guarda la
    // petición íntegra (hasta 4000 chars) para que se lea completa en la UI.
    const firstSentence = petition.split(/(?<=\.)\s+/)[0] || petition;
    const shortName = (firstSentence.length <= 100 ? firstSentence : firstSentence.slice(0, 97) + "…").trim();
    out.push({
      id: `${slug}-registry-${slugify(idShort)}`,
      source: "registry",
      name: shortName || idShort,
      description: petition.slice(0, 4000) || `Entrada del registry: ${idShort}`,
      url: urlAffected,
      qaFlow,
      priority,
    });
  }
  return out;
}

async function fetchExisting(slug) {
  const r = await fetch(`${API}/api/specs?project=${slug}`);
  const data = await r.json();
  return new Map(data.map(s => [s.id, s]));
}

async function upsert(spec) {
  const r = await fetch(`${API}/api/specs?token=${encodeURIComponent(TOKEN)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(spec),
  });
  if (!r.ok) throw new Error(`POST /api/specs ${r.status}: ${await r.text()}`);
  return r.json();
}

for (const proj of projects) {
  const claudeDir = path.join(proj.path, ".claude");
  if (!fs.existsSync(claudeDir)) {
    console.log(`[${proj.slug}] sin .claude/ — skip`);
    continue;
  }
  const matrixContent = readSafe(path.join(claudeDir, "specs", "full-app-matrix.md"));
  const registryContent = readSafe(path.join(claudeDir, "peticiones-registry.md"));
  const entries = [
    ...parseMatrix(proj.slug, matrixContent),
    ...parseRegistry(proj.slug, registryContent),
  ];
  const existing = await fetchExisting(proj.slug);
  console.log(`\n[${proj.slug}] entries=${entries.length} (matrix=${parseMatrix(proj.slug, matrixContent).length} registry=${parseRegistry(proj.slug, registryContent).length})  existing=${existing.size}`);

  let upserted = 0, errors = 0;
  for (const e of entries) {
    const prev = existing.get(e.id);
    const spec = {
      id: e.id,
      projectSlug: proj.slug,
      source: e.source,
      name: e.name,
      description: e.description,
      url: e.url || null,
      qaFlow: e.qaFlow,
      priority: e.priority,
      state: prev?.lastVerdict ? prev.state : "pending",
      createdBy: e.source + "-import",
    };
    try {
      await upsert(spec);
      upserted++;
    } catch (err) {
      console.error(`  ERR ${e.id}: ${err.message.slice(0, 120)}`);
      errors++;
    }
  }
  console.log(`[${proj.slug}] upserted=${upserted} errors=${errors}`);
}

console.log("\nDone. Abre https://qa-velzia.chany-velzia.workers.dev/specs?token=" + TOKEN);
