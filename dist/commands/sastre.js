// Comando /sastre — aplica findings approved + open whitelist con retry-5 + auto-merge condicional.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { FindingsApi } from "../core/findings-api.js";
import { loadEnv } from "../types/config.js";
const SENSITIVE_DIRS = ["auth/", "lib/supabase/", "middleware", "payments/", "supabase/migrations/", ".env"];
const HARD_CAP_PER_NIGHT = 10;
const HARD_CAP_PER_FILE = 1;
function isSensitivePath(p) {
    return SENSITIVE_DIRS.some((s) => p.includes(s));
}
function sh(cmd, cwd) {
    try {
        const out = execSync(cmd, { cwd, encoding: "utf8", stdio: "pipe" });
        return { ok: true, out: out.toString(), err: "" };
    }
    catch (e) {
        return { ok: false, out: e.stdout?.toString() || "", err: e.stderr?.toString() || e.message };
    }
}
function applyFix(cwd, fix) {
    const filePath = path.isAbsolute(fix.path) ? fix.path : path.join(cwd, fix.path);
    if (!fs.existsSync(filePath))
        return { ok: false, reason: `archivo no existe: ${fix.path}` };
    const content = fs.readFileSync(filePath, "utf8");
    const occ = content.split(fix.old).length - 1;
    const newOcc = fix.new ? content.split(fix.new).length - 1 : 0;
    if (occ === 0 && newOcc > 0)
        return { ok: true, reason: "idempotent: ya aplicado" };
    if (occ === 0)
        return { ok: false, reason: `'old' no encontrado en ${fix.path}` };
    if (occ > 1 && !fix.replaceAll)
        return { ok: false, reason: `'old' aparece ${occ} veces, marca replaceAll` };
    const replaced = fix.replaceAll ? content.split(fix.old).join(fix.new) : content.replace(fix.old, fix.new);
    fs.writeFileSync(filePath, replaced, "utf8");
    return { ok: true };
}
export async function runSastre(args) {
    const env = loadEnv();
    const cwd = path.resolve(args.cwd);
    const findingsApi = new FindingsApi(env);
    const runId = env.RUN_ID || `sastre-${Date.now()}`;
    // Detectar slug del proyecto desde config local.
    const cfgPath = path.join(cwd, ".claude", "qa-nocturno.config.json");
    if (!fs.existsSync(cfgPath))
        throw new Error(`Falta ${cfgPath}`);
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    const projectSlug = cfg.slug;
    console.log(`[sastre] start runId=${runId} project=${projectSlug}`);
    // 1. Fetch findings aplicables.
    const approved = await findingsApi.list({ project: projectSlug, state: "approved" });
    const open = await findingsApi.list({ project: projectSlug, state: "open" });
    const autoApprovable = open.filter((f) => f.whitelistMatch && f.applyEnabled && f.fixes.length > 0);
    let candidates = [...approved, ...autoApprovable];
    // Filtros hard caps.
    candidates = candidates.filter((f) => {
        const sensitive = (f.fixes || []).some((fx) => isSensitivePath(fx.path));
        if (sensitive) {
            console.log(`[sastre] skip ${f.id}: toca dir sensible`);
            return false;
        }
        return true;
    });
    // Max 10 / noche.
    candidates = candidates.slice(0, HARD_CAP_PER_NIGHT);
    // Max 1 / archivo.
    const seenFiles = new Set();
    candidates = candidates.filter((f) => {
        const paths = (f.fixes || []).map((fx) => fx.path);
        for (const p of paths) {
            if (seenFiles.has(p))
                return false;
        }
        paths.forEach((p) => seenFiles.add(p));
        return true;
    });
    console.log(`[sastre] candidates aplicables: ${candidates.length}`);
    if (candidates.length === 0 || args.dryRun) {
        console.log(args.dryRun ? "[sastre] dry-run, exit" : "[sastre] nothing to do");
        return;
    }
    // 2. Crear branch.
    const branchName = `qa/sastre-${new Date().toISOString().slice(0, 10)}`;
    console.log(`[sastre] checkout -b ${branchName}`);
    sh(`git checkout -b ${branchName}`, cwd);
    // 3. Aplicar cada finding con retry-5.
    const applied = [];
    for (const f of candidates) {
        let success = false;
        const fixSets = [f.fixes, ...(f.fixesAlternatives || [])];
        for (let attempt = 0; attempt < Math.min(5, fixSets.length); attempt++) {
            const fixes = fixSets[attempt];
            if (!fixes || fixes.length === 0)
                continue;
            console.log(`[sastre] ${f.id} attempt ${attempt + 1}: ${fixes.length} fixes`);
            let allOk = true;
            const touchedPaths = [];
            for (const fx of fixes) {
                const r = applyFix(cwd, fx);
                if (!r.ok) {
                    console.log(`  fail: ${r.reason}`);
                    allOk = false;
                    break;
                }
                touchedPaths.push(fx.path);
            }
            if (!allOk) {
                sh(`git checkout -- ${touchedPaths.map((p) => `"${p}"`).join(" ")}`, cwd);
                continue;
            }
            // Build gate.
            const tc = sh(`npm run typecheck`, cwd);
            const build = tc.ok ? sh(`NODE_OPTIONS="--max-old-space-size=8192" npm run build`, cwd) : { ok: false, out: "", err: "skip" };
            if (!tc.ok || !build.ok) {
                console.log(`  build/typecheck failed: ${(tc.err || build.err).slice(0, 200)}`);
                sh(`git checkout -- ${touchedPaths.map((p) => `"${p}"`).join(" ")}`, cwd);
                continue;
            }
            success = true;
            console.log(`  ✓ ${f.id} aplicado`);
            applied.push(f);
            break;
        }
        if (!success) {
            console.log(`[sastre] ${f.id} no aplicable tras 5 intentos — marca como necesita atención humana`);
            await findingsApi.patch(f.id, { applyEnabled: false, recommendation: (f.recommendation || "") + " · Sastre 5 intentos sin éxito." });
        }
    }
    if (applied.length === 0) {
        console.log("[sastre] 0 aplicados, no commit");
        return;
    }
    // 4. Commit + push.
    sh(`git add .`, cwd);
    const msg = `fix(qa-sastre): aplicar ${applied.length} findings aprobados\n\n${applied.map((f) => `- ${f.id}: ${f.summary}`).join("\n")}\n\nCo-Authored-By: Sastre bot <sastre@velzia.com>`;
    fs.writeFileSync(path.join(cwd, ".git", "qa-sastre-msg.txt"), msg, "utf8");
    sh(`git commit -F .git/qa-sastre-msg.txt`, cwd);
    fs.unlinkSync(path.join(cwd, ".git", "qa-sastre-msg.txt"));
    sh(`git push -u origin ${branchName}`, cwd);
    // 5. Open PR with sastre-autopilot label (requires gh CLI in GH Actions runner).
    const prTitle = `fix(qa-sastre): ${applied.length} findings ${new Date().toISOString().slice(0, 10)}`;
    const prBody = msg;
    fs.writeFileSync(path.join(cwd, ".git", "qa-sastre-pr.md"), prBody, "utf8");
    const prResult = sh(`gh pr create --title "${prTitle.replace(/"/g, '\\"')}" --body-file .git/qa-sastre-pr.md --label sastre-autopilot --base master`, cwd);
    fs.unlinkSync(path.join(cwd, ".git", "qa-sastre-pr.md"));
    if (!prResult.ok)
        console.log(`[sastre] gh pr create failed: ${prResult.err}`);
    // 6. Patch findings con state=applied (commit/branch real).
    const sha = sh(`git rev-parse --short HEAD`, cwd).out.trim();
    for (const f of applied) {
        await findingsApi.patch(f.id, { state: "applied", appliedAt: new Date().toISOString(), appliedCommit: sha, appliedBranch: branchName });
    }
    console.log(`[sastre] done: ${applied.length} fixes aplicados en ${branchName}, PR creado.`);
}
