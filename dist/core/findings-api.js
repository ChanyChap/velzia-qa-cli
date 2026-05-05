export class FindingsApi {
    env;
    constructor(env) {
        this.env = env;
    }
    headers() {
        return {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.env.QA_VELZIA_API_TOKEN}`,
        };
    }
    async list(filter) {
        const qs = new URLSearchParams();
        if (filter.project)
            qs.set("project", filter.project);
        if (filter.state)
            qs.set("state", filter.state);
        if (filter.severity)
            qs.set("severity", filter.severity);
        if (filter.type)
            qs.set("type", filter.type);
        const r = await fetch(`${this.env.QA_VELZIA_API_URL}/api/findings?${qs}`, { headers: this.headers() });
        if (!r.ok)
            throw new Error(`findings list ${r.status}: ${await r.text()}`);
        return r.json();
    }
    async upsert(finding) {
        const r = await fetch(`${this.env.QA_VELZIA_API_URL}/api/findings`, {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify(finding),
        });
        if (!r.ok)
            throw new Error(`findings upsert ${r.status}: ${await r.text()}`);
        return r.json();
    }
    async patch(id, patch) {
        const r = await fetch(`${this.env.QA_VELZIA_API_URL}/api/findings/${encodeURIComponent(id)}`, {
            method: "PATCH",
            headers: this.headers(),
            body: JSON.stringify(patch),
        });
        if (!r.ok)
            throw new Error(`findings patch ${r.status}: ${await r.text()}`);
    }
    async openRun(run) {
        const r = await fetch(`${this.env.QA_VELZIA_API_URL}/api/runs`, {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify(run),
        });
        if (!r.ok)
            throw new Error(`runs open ${r.status}: ${await r.text()}`);
    }
    async closeRun(id, summary) {
        const r = await fetch(`${this.env.QA_VELZIA_API_URL}/api/runs/${encodeURIComponent(id)}`, {
            method: "PATCH",
            headers: this.headers(),
            body: JSON.stringify({ ...summary, finishedAt: new Date().toISOString() }),
        });
        if (!r.ok)
            throw new Error(`runs close ${r.status}: ${await r.text()}`);
    }
}
export function makeFindingId(projectSlug, type, area, summary) {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    // Stable hash via simple djb2 (runtime sin crypto.subtle ni node:crypto duplicado).
    let hash = 5381;
    const s = `${type}|${area}|${summary}`;
    for (let i = 0; i < s.length; i++)
        hash = ((hash << 5) + hash + s.charCodeAt(i)) >>> 0;
    return `${projectSlug}-${today}-${hash.toString(16).slice(-8)}`;
}
