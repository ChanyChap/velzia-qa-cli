// Cambia engine.type = "stagehand-local" en .claude/qa-nocturno.config.json
// de los 4 repos. Quita la dependencia de Browserbase (que se quedó sin
// minutos en plan free) y usa Playwright local en el runner de GH Actions.

import { execSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "switch-engine-"));

const repos = [
  { full: "florkbu/rt.sig", branch: "claude/mvp-nextjs-supabase-lQ9Oe" },
  { full: "ChanyChap/Factorias", branch: "main" },
  { full: "ChanyChap/velziaonsite", branch: "master" },
  { full: "ChanyChap/velziacad", branch: "master" },
];

const path = ".claude/qa-nocturno.config.json";

function gh(args, allowFail = false) {
  try {
    return execSync(`gh ${args}`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    if (allowFail) return null;
    throw e;
  }
}

for (const r of repos) {
  console.log(`\n=== ${r.full} ===`);

  // Leer el config actual.
  const current = gh(`api repos/${r.full}/contents/${path} --jq .`, true);
  if (!current) { console.log(`  no hay ${path}`); continue; }
  const meta = JSON.parse(current);
  const sha = meta.sha;
  const decoded = JSON.parse(Buffer.from(meta.content, "base64").toString("utf8"));

  const before = decoded.engine?.type;
  if (before === "stagehand-local") {
    console.log(`  ya es stagehand-local — skip`);
    continue;
  }

  // Cambiar engine.
  decoded.engine = decoded.engine || {};
  decoded.engine.type = "stagehand-local";
  decoded.engine.parallel = decoded.engine.parallel || 1;
  // Quitamos config browserbase si la había.
  delete decoded.engine.browserbase;

  const newContent = JSON.stringify(decoded, null, 2) + "\n";
  const body = {
    message: "chore(qa): switch engine to stagehand-local (sin Browserbase)",
    content: Buffer.from(newContent, "utf8").toString("base64"),
    branch: r.branch,
    sha,
  };
  const tmpFile = join(TMP, `body-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(tmpFile, JSON.stringify(body), "utf8");
  try {
    const out = gh(`api -X PUT repos/${r.full}/contents/${path} --input "${tmpFile}"`);
    const parsed = JSON.parse(out);
    console.log(`  OK before="${before}" after="stagehand-local" commit=${parsed.commit?.sha?.slice(0, 8)}`);
  } catch (e) {
    console.error(`  ERR: ${e.stderr || e.message}`);
  }
}
