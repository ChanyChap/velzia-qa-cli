// Cliente HTTP para la tabla `specs` del Worker qa-velzia.
// Centinela invoca list() al planificar y patch() al terminar cada feature.
export class SpecsApi {
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
        const r = await fetch(`${this.env.QA_VELZIA_API_URL}/api/specs?${qs}`, { headers: this.headers() });
        if (!r.ok)
            throw new Error(`specs list ${r.status}: ${await r.text()}`);
        return r.json();
    }
    async upsert(spec) {
        const r = await fetch(`${this.env.QA_VELZIA_API_URL}/api/specs`, {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify(spec),
        });
        if (!r.ok)
            throw new Error(`specs upsert ${r.status}: ${await r.text()}`);
        return r.json();
    }
    async patch(id, patch) {
        const r = await fetch(`${this.env.QA_VELZIA_API_URL}/api/specs/${encodeURIComponent(id)}`, {
            method: "PATCH",
            headers: this.headers(),
            body: JSON.stringify(patch),
        });
        if (!r.ok)
            throw new Error(`specs patch ${r.status}: ${await r.text()}`);
    }
    /**
     * Reporta el verdict de un run sobre una spec. Actualiza last_*, recalcula
     * pass_streak y mueve el state según el verdict.
     */
    async reportVerdict(id, verdict, runId, currentPassStreak) {
        const newStreak = verdict === "PASS" ? currentPassStreak + 1 : 0;
        const newState = verdict === "PASS" ? "passing"
            : verdict === "FAIL" ? "failing"
                : "blocked";
        // NO bajamos la prioridad tras X PASS — al contrario, las passing se siguen
        // probando en LRU para detectar regresiones (que algo que pasaba ayer rompa
        // hoy por un cambio nuevo). El control de regresión está en el planner, no aquí.
        const patch = {
            lastRunId: runId,
            lastVerdict: verdict,
            lastRunAt: new Date().toISOString(),
            passStreak: newStreak,
            state: newState,
        };
        await this.patch(id, patch);
    }
}
