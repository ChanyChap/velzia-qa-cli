// Cliente HTTP para el Worker Cloudflare en qa.velzia.com
import type { Finding } from "../types/finding.js";
import type { RuntimeEnv } from "../types/config.js";

export class FindingsApi {
  constructor(private env: RuntimeEnv) {}

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.env.QA_VELZIA_API_TOKEN}`,
    };
  }

  async list(filter: { project?: string; state?: string; severity?: string; type?: string }): Promise<Finding[]> {
    const qs = new URLSearchParams();
    if (filter.project) qs.set("project", filter.project);
    if (filter.state) qs.set("state", filter.state);
    if (filter.severity) qs.set("severity", filter.severity);
    if (filter.type) qs.set("type", filter.type);
    const r = await fetch(`${this.env.QA_VELZIA_API_URL}/api/findings?${qs}`, { headers: this.headers() });
    if (!r.ok) throw new Error(`findings list ${r.status}: ${await r.text()}`);
    return r.json() as Promise<Finding[]>;
  }

  async upsert(finding: Partial<Finding>): Promise<{ ok: boolean; id: string }> {
    const r = await fetch(`${this.env.QA_VELZIA_API_URL}/api/findings`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(finding),
    });
    if (!r.ok) throw new Error(`findings upsert ${r.status}: ${await r.text()}`);
    return r.json() as Promise<{ ok: boolean; id: string }>;
  }

  async patch(id: string, patch: Partial<Finding>): Promise<void> {
    const r = await fetch(`${this.env.QA_VELZIA_API_URL}/api/findings/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: this.headers(),
      body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error(`findings patch ${r.status}: ${await r.text()}`);
  }

  async openRun(run: { id: string; agent: string; projectSlug?: string; startedAt?: string }): Promise<void> {
    const r = await fetch(`${this.env.QA_VELZIA_API_URL}/api/runs`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(run),
    });
    if (!r.ok) throw new Error(`runs open ${r.status}: ${await r.text()}`);
  }

  async closeRun(id: string, summary: { status: string; passCount?: number; failCount?: number; blockedCount?: number; findingsNew?: number; findingsApplied?: number; costUsd?: number; githubRunUrl?: string; error?: string; logExcerpt?: string }): Promise<void> {
    const r = await fetch(`${this.env.QA_VELZIA_API_URL}/api/runs/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: this.headers(),
      body: JSON.stringify({ ...summary, finishedAt: new Date().toISOString() }),
    });
    if (!r.ok) throw new Error(`runs close ${r.status}: ${await r.text()}`);
  }
}

export function makeFindingId(projectSlug: string, type: string, area: string, summary: string): string {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  // Stable hash via simple djb2 (runtime sin crypto.subtle ni node:crypto duplicado).
  let hash = 5381;
  const s = `${type}|${area}|${summary}`;
  for (let i = 0; i < s.length; i++) hash = ((hash << 5) + hash + s.charCodeAt(i)) >>> 0;
  return `${projectSlug}-${today}-${hash.toString(16).slice(-8)}`;
}
