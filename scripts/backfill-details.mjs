// Backfill one-shot: enriquece findings type=bug que ya están en open con
// `details_json` derivado del `rootCause` crudo, aplicando las heurísticas.
//
// Estrategia (Windows-friendly):
//  1. Leer findings via HTTP GET /api/findings?state=open (público).
//  2. Calcular details_json + recommendation por cada uno con runHeuristics.
//  3. Escribir todos los UPDATEs a updates.sql.
//  4. wrangler d1 execute --file=updates.sql (transaccional).

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { classifyAll, runHeuristics } from "../dist/core/diagnostician.js";

const API = "https://qa-velzia.chany-velzia.workers.dev";
const DB_NAME = "qa-velzia-findings";
const WORKER_DIR = "C:\\Users\\Chany Chapnik\\.claude\\scripts\\qa-cloud\\worker";
// Importante: path SIN espacios para evitar problemas de quoting con spawnSync+shell:true.
const SQL_OUT = "C:\\Users\\Chany Chapnik\\.claude\\scripts\\qa-cloud\\worker\\_backfill_details.sql";

const projectProd = {
  "rt.sig": "https://refotask.com",
  "velziaonsite": "https://onsite-velzia.vercel.app",
  "velziacad": "https://cad.velzia.com",
  "factorias": "https://factorias.velzia.com",
};

function inferFeatureName(area) {
  if (!area) return "Feature desconocida";
  const last = area.split("/").filter(Boolean).pop() || area;
  return last.replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function parseRootCause(rootCause) {
  if (!rootCause) return { networkErrors: [], consoleErrors: [] };
  const parts = rootCause.split(" · ");
  const networkErrors = [];
  const consoleErrors = [];
  const arrowSplit = /^(?:\[\w+\]\s*)?(.+?)\s*[→\->]+\s*(\d{3})\s*$/;
  for (const p of parts) {
    const m = p.match(arrowSplit);
    if (m && m[1].startsWith("http")) {
      networkErrors.push({ endpoint: m[1].trim(), status: parseInt(m[2], 10) });
    } else if (p.trim()) {
      consoleErrors.push(p.trim());
    }
  }
  return { networkErrors, consoleErrors };
}

function sqlEscape(s) {
  return String(s == null ? "" : s).replace(/'/g, "''");
}

console.log("[backfill] GET /api/findings?state=open ...");
const res = await fetch(`${API}/api/findings?state=open`);
const all = await res.json();
const bugs = all.filter((f) => f.type === "bug" && !f.details);
console.log(`[backfill] total open=${all.length}, bugs sin details=${bugs.length}`);

const updates = [];
let skipped = 0;

for (const f of bugs) {
  const prodHost = projectProd[f.projectSlug];
  if (!prodHost) { skipped++; continue; }
  const { networkErrors: rawNet, consoleErrors } = parseRootCause(f.rootCause);
  const networkErrors = classifyAll(rawNet, prodHost);
  const featureName = inferFeatureName(f.area);
  const diag = runHeuristics({
    featureName,
    featureUrl: f.area,
    networkErrors,
    consoleErrors,
  });
  if (!diag) { skipped++; continue; }

  const details = {
    feature: { id: "backfill", name: featureName, url: f.area, source: "matrix" },
    qaFlow: { available: false, stepsExecuted: [{ action: "navigate", selector: f.area, result: "DOM cargado" }] },
    evidence: { networkErrors, consoleErrors, failNote: f.summary },
    risks: diag.risks,
    diagnosis: diag.diagnosis,
  };

  updates.push({ id: f.id, details: JSON.stringify(details), recommendation: diag.recommendation });
}

console.log(`[backfill] ${updates.length} updates a escribir (skipped=${skipped})`);

if (updates.length > 0) {
  const sql = updates
    .map((u) =>
      `UPDATE findings SET details_json = '${sqlEscape(u.details)}', recommendation = '${sqlEscape(u.recommendation)}' WHERE id = '${sqlEscape(u.id)}';`,
    )
    .join("\n");
  writeFileSync(SQL_OUT, sql, "utf8");
  console.log(`[backfill] SQL escrito a ${SQL_OUT}`);

  console.log("[backfill] aplicando con wrangler d1 execute --file ...");
  // path relativo al cwd para evitar comillas en el shell.
  const relSql = "_backfill_details.sql";
  const r = spawnSync(".\\node_modules\\.bin\\wrangler.cmd", [
    "d1", "execute", DB_NAME, "--remote", `--file=${relSql}`, "--yes",
  ], {
    cwd: WORKER_DIR,
    encoding: "utf8",
    shell: true,
    windowsHide: true,
    stdio: "inherit",
  });
  if (r.status !== 0) {
    console.error(`[backfill] wrangler exit ${r.status}`);
    process.exit(1);
  }
  console.log(`[backfill] done. updated=${updates.length}`);
} else {
  console.log("[backfill] nada que actualizar.");
}
