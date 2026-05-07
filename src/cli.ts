#!/usr/bin/env node
// CLI bin entry point — dispatches to centinela or sastre.

import { runCentinela } from "./commands/centinela.js";
import { runSastre } from "./commands/sastre.js";

function parseArgs(argv: string[]): { command: string; flags: Record<string, string | boolean> } {
  const [command, ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next && !next.startsWith("--")) { flags[key] = next; i++; }
      else flags[key] = true;
    }
  }
  return { command, flags };
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const cwd = (flags.cwd as string) || process.cwd();

  switch (command) {
    case "centinela": {
      const mode = (flags.mode as any) || (flags.smoke ? "smoke" : flags.diff ? "diff-cover" : "full");
      const diffFiles = flags["diff-files"] ? String(flags["diff-files"]).split(",") : undefined;
      const maxFeatures = flags["max-features"] ? parseInt(String(flags["max-features"]), 10) : undefined;
      await runCentinela({ cwd, mode, diffFiles, maxFeatures });
      break;
    }
    case "sastre": {
      await runSastre({ cwd, dryRun: !!flags["dry-run"] });
      break;
    }
    case "version":
    case "--version":
    case "-v":
      console.log("@chanychap/qa-cli 0.2.0");
      break;
    default:
      console.error(`Uso:
  qa-cli centinela [--mode full|smoke|diff-cover|pending-priority] [--cwd <path>] [--diff-files a.ts,b.ts] [--max-features 50]
  qa-cli sastre [--dry-run] [--cwd <path>]
  qa-cli version`);
      process.exit(command ? 1 : 0);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
