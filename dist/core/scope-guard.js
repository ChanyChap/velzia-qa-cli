// F2 portado a TS — bloquea acciones mutantes sobre proyectos != QA_USER_PROJECT_ID.
const MUTANT_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const MUTANT_PLAYWRIGHT_ACTIONS = new Set(["click", "fill", "fill_form", "type", "press_key", "drag", "drop", "upload", "select_option"]);
export function isMutantAction(action) {
    if (!action)
        return false;
    if (action.method && MUTANT_METHODS.has(action.method.toUpperCase()))
        return true;
    if (action.action && MUTANT_PLAYWRIGHT_ACTIONS.has(action.action))
        return true;
    if (action.sql)
        return /^\s*(insert|update|delete|truncate|drop|alter)\b/i.test(action.sql);
    return false;
}
export function extractProjectId(action) {
    if (!action)
        return null;
    if (action.body && typeof action.body === "object") {
        if (action.body.proyecto_id)
            return action.body.proyecto_id;
        if (action.body.project_id)
            return action.body.project_id;
        if (action.body.projectId)
            return action.body.projectId;
    }
    const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    if (action.url) {
        const m = action.url.match(uuidRe);
        if (m)
            return m[0];
    }
    if (action.sql) {
        const m = action.sql.match(/proyecto_id\s*=\s*['"]([0-9a-f-]{36})['"]/i);
        if (m)
            return m[1];
    }
    if (action.testid) {
        const m = action.testid.match(uuidRe);
        if (m)
            return m[0];
    }
    return null;
}
export class ScopeGuardError extends Error {
    action;
    constructor(message, action) {
        super(message);
        this.name = "ScopeGuardError";
        this.action = action;
    }
}
export function assertScopeOk(action, allowedProjectId) {
    if (!isMutantAction(action))
        return;
    if (action.bypassScopeGuard === true)
        return;
    const pid = extractProjectId(action);
    if (!pid) {
        throw new ScopeGuardError(`Scope-guard: acción mutante sin proyecto_id identificable. Marca bypassScopeGuard:true si es genérica.`, action);
    }
    if (pid !== allowedProjectId) {
        throw new ScopeGuardError(`Scope-guard: acción mutante apunta a ${pid} pero solo ${allowedProjectId} permitido.`, action);
    }
}
