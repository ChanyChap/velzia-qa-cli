// Cambia slug:"onsite" -> "velziaonsite" en el config remoto del repo.
// Alinea con el resto de proyectos y con los slugs aceptados por el Worker.

import { execSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "fix-slug-"));

const repo = "ChanyChap/velziaonsite";
const branch = "master";
const path = ".claude/qa-nocturno.config.json";

const meta = JSON.parse(execSync(`gh api repos/${repo}/contents/${path}`, { encoding: "utf8" }));
const decoded = JSON.parse(Buffer.from(meta.content, "base64").toString("utf8"));
const before = decoded.slug;

if (before === "velziaonsite") { console.log("ya es velziaonsite, skip"); process.exit(0); }

decoded.slug = "velziaonsite";
const newContent = JSON.stringify(decoded, null, 2) + "\n";

const body = {
  message: "chore(qa): align slug to velziaonsite (era 'onsite', causaba mismatch con D1)",
  content: Buffer.from(newContent, "utf8").toString("base64"),
  branch,
  sha: meta.sha,
};
const tmpFile = join(TMP, "body.json");
writeFileSync(tmpFile, JSON.stringify(body), "utf8");
const out = execSync(`gh api -X PUT repos/${repo}/contents/${path} --input "${tmpFile}"`, { encoding: "utf8" });
const parsed = JSON.parse(out);
console.log(`OK ${before} -> velziaonsite, commit=${parsed.commit?.sha?.slice(0, 8)}`);
