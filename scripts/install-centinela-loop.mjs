// Instala el workflow centinela-loop.yml en los 4 repos de Chany via gh API.
// Idempotente: si el archivo ya existe, lo actualiza; si no, lo crea.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "gh-install-"));

const TEMPLATE = readFileSync(
  "C:\\Users\\Chany Chapnik\\Documents\\Claude\\velzia-qa-cli\\.github\\workflows\\centinela-loop.template.yml",
  "utf8",
);

const repos = [
  { full: "florkbu/rt.sig", branch: "claude/mvp-nextjs-supabase-lQ9Oe" },
  { full: "ChanyChap/Factorias", branch: "main" },
  { full: "ChanyChap/velziaonsite", branch: "master" },
  { full: "ChanyChap/velziacad", branch: "master" },
];

const path = ".github/workflows/centinela-loop.yml";
const contentB64 = Buffer.from(TEMPLATE, "utf8").toString("base64");

function gh(args) {
  return execSync(`gh ${args}`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

for (const r of repos) {
  console.log(`\n=== ${r.full} ===`);
  // Leer SHA si existe el archivo (necesario para update via PUT).
  let existingSha = null;
  try {
    const out = gh(`api repos/${r.full}/contents/${path} --jq .sha`);
    existingSha = out.trim();
    console.log(`  ya existe (sha=${existingSha.slice(0, 8)}), actualizando…`);
  } catch {
    console.log("  no existe, creando…");
  }

  const body = {
    message: existingSha ? "ci: update centinela-loop workflow" : "ci: install centinela-loop workflow (24/7)",
    content: contentB64,
    branch: r.branch,
    ...(existingSha ? { sha: existingSha } : {}),
  };

  const tmpFile = join(TMP, `body-${Date.now()}.json`);
  writeFileSync(tmpFile, JSON.stringify(body), "utf8");

  try {
    const result = gh(`api -X PUT repos/${r.full}/contents/${path} --input "${tmpFile}"`);
    const parsed = JSON.parse(result);
    console.log(`  OK commit=${parsed.commit?.sha?.slice(0, 8)}`);
  } catch (e) {
    console.error(`  ERR: ${e.stderr || e.message}`);
  }
}

console.log("\nDone. Mirar workflows en GH Actions de cada repo.");
