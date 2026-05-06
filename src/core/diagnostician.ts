// Diagnóstico humano del finding: convierte la ráfaga de network/console errors
// en un texto que Chany pueda leer y decidir sin abrir DevTools.
//
// Estrategia (mix elegida en /ama):
// 1. classifyLayer() etiqueta cada error de red con su capa (supabase/backend/third-party).
// 2. runHeuristics() detecta patrones conocidos (5xx, 406 PostgREST, 404, 401, 403)
//    y devuelve diagnosis + recommendation + risks ya redactados. Coste $0.
// 3. Si no matchea ningún patrón, llamamos a Haiku 4.5 con un prompt corto
//    para que escriba el diagnóstico. Coste ~$0.005/finding.

import type { AnthropicClient } from "./anthropic-client.js";
import type {
  NetworkErrorClassified,
  NetworkLayer,
} from "../types/finding.js";

export interface DiagnosisInput {
  featureName: string;
  featureUrl?: string;
  finalUrl?: string;
  failNote?: string;
  blockReason?: string;
  networkErrors: NetworkErrorClassified[];
  consoleErrors: string[];
}

export interface DiagnosisOutput {
  diagnosis: string;
  recommendation: string;
  risks: string[];
}

/**
 * Etiqueta cada URL con la capa donde ocurre. Detecta:
 *   - "*.supabase.co/rest/" / "/auth/" / "/storage/" → supabase
 *   - el dominio prod del proyecto QA → backend
 *   - cualquier otra URL → third-party / unknown
 */
export function classifyLayer(
  url: string,
  prodHost: string,
): NetworkLayer {
  if (!url) return "unknown";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "unknown";
  }
  if (parsed.hostname.endsWith(".supabase.co")) return "supabase";
  try {
    const prod = new URL(prodHost);
    if (parsed.hostname === prod.hostname) return "backend";
  } catch {
    /* prodHost mal formado, ignorar */
  }
  // Heurística: si la ruta empieza por /api/ y no es un dominio conocido externo, asumir backend.
  if (parsed.pathname.startsWith("/api/")) return "backend";
  return "third-party";
}

export function classifyAll(
  rawErrors: Array<{ endpoint: string; status: number; method?: string }>,
  prodHost: string,
): NetworkErrorClassified[] {
  return rawErrors.map((e) => ({
    ...e,
    layer: classifyLayer(e.endpoint, prodHost),
  }));
}

/**
 * Reglas heurísticas — devuelve null si ninguna matchea.
 * Cada regla emite diagnosis + recommendation + risks ya redactados.
 */
export function runHeuristics(input: DiagnosisInput): DiagnosisOutput | null {
  const ne = input.networkErrors;
  const supa406 = ne.find((e) => e.layer === "supabase" && e.status === 406);
  const supa403 = ne.find((e) => e.layer === "supabase" && e.status === 403);
  const supa401 = ne.find((e) => e.layer === "supabase" && e.status === 401);
  const backend5xx = ne.find((e) => e.layer === "backend" && e.status >= 500);
  const backend404 = ne.find((e) => e.layer === "backend" && e.status === 404);
  const backend401 = ne.find((e) => e.layer === "backend" && e.status === 401);
  const has5xxAny = ne.some((e) => e.status >= 500);

  // Patrón A — combo Supabase 406 + backend 5xx (el típico que vimos).
  if (supa406 && backend5xx) {
    return {
      diagnosis:
        `La capa Supabase devolvió 406 en ${shortPath(supa406.endpoint)} ` +
        `(la query usa .single() o Accept pgrst.object+json esperando 1 fila y la RLS o el filtro ` +
        `devolvió 0 filas). El handler de ${shortPath(backend5xx.endpoint)} no maneja ese caso ` +
        `y revienta con 5xx, lo que provoca que la UI quede rota mientras carga ${input.featureName}.`,
      recommendation:
        `Cambiar la query a .maybeSingle() y manejar el null con un fallback explícito. ` +
        `Revisar también la policy RLS de la tabla involucrada por si el rol del QA user no tiene permiso.`,
      risks: [
        `Mientras no se arregle, ${input.featureName} no funciona para el rol que pruebe Centinela.`,
        "Si la tabla afectada es de permisos/auth, puede ser que admins reales también lo vean roto.",
        "Aprobar este finding implica asumir que hay que tocar capa de datos (query) y revisar RLS.",
      ],
    };
  }

  // Patrón B — solo Supabase 406 (sin 5xx aguas abajo).
  if (supa406 && !has5xxAny) {
    return {
      diagnosis:
        `Supabase devolvió 406 en ${shortPath(supa406.endpoint)}. La query espera exactamente ` +
        `1 fila (.single() o Accept pgrst.object+json) y obtuvo 0. El frontend lo trata como error.`,
      recommendation:
        "Cambiar a .maybeSingle() y manejar el caso null en el componente que lee este recurso.",
      risks: [
        `${input.featureName} muestra error donde debería mostrar estado vacío.`,
        "Bajo: solo afecta UX cuando no existe el registro consultado.",
      ],
    };
  }

  // Patrón C — backend 5xx sin Supabase 406.
  if (backend5xx) {
    return {
      diagnosis:
        `El backend devolvió ${backend5xx.status} en ${shortPath(backend5xx.endpoint)}. ` +
        `Algo en el handler revienta — puede ser una excepción no controlada, un timeout de DB, ` +
        `o una llamada a un servicio externo que falló.`,
      recommendation:
        "Revisar logs del endpoint en Vercel/Cloudflare. Buscar try/catch que falte y devolver 4xx con mensaje en vez de 5xx silencioso.",
      risks: [
        `${input.featureName} no carga para el usuario.`,
        "Si el endpoint es del bootstrap de la app (auth, permisos), bloquea TODA la app, no solo esta feature.",
      ],
    };
  }

  // Patrón D — 404 backend (ruta no existe o id null).
  if (backend404 && !backend5xx) {
    return {
      diagnosis:
        `El backend devolvió 404 en ${shortPath(backend404.endpoint)}. La ruta no existe en la app, ` +
        `o el id de la URL llega como null/undefined al montar el componente.`,
      recommendation:
        "Verificar que la ruta esté declarada (revisar app router) y que el id se cargue antes del fetch (skip el fetch si id es nullish).",
      risks: [
        `${input.featureName} muestra 404 al usuario.`,
        "Si el id se pierde por race condition, puede ser intermitente y difícil de reproducir manualmente.",
      ],
    };
  }

  // Patrón E — auth perdida (401 en cualquier capa).
  if (supa401 || backend401) {
    const e = supa401 || backend401!;
    return {
      diagnosis:
        `Recibimos 401 en ${shortPath(e.endpoint)} (${e.layer}). La sesión del usuario QA se perdió ` +
        `o el token expiró durante la prueba.`,
      recommendation:
        "Si pasa solo en QA: revisar duración del token de QA. Si pasa también en prod: la app debe refrescar el token automáticamente o redirigir a login con mensaje claro.",
      risks: [
        "Bajo: probablemente solo afecta a sesiones largas.",
        "Si la app no detecta el 401, el usuario ve datos vacíos sin saber por qué.",
      ],
    };
  }

  // Patrón F — 403 Supabase (RLS).
  if (supa403) {
    return {
      diagnosis:
        `Supabase devolvió 403 en ${shortPath(supa403.endpoint)}. La RLS rechaza al rol del QA user ` +
        `(${input.featureName}).`,
      recommendation:
        "Revisar la policy RLS de la tabla. Decidir si el rol debe poder leer/escribir y ajustar la policy o el rol.",
      risks: [
        "Si el rol QA es 'admin_empresa' y se le rechaza, probablemente hay un bug en la policy que afecta a admins reales también.",
      ],
    };
  }

  return null;
}

function shortPath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + (u.search ? u.search.slice(0, 80) : "");
  } catch {
    return url.slice(0, 100);
  }
}

/**
 * Punto de entrada principal: aplica heurísticas y, si no hay match, llama a Haiku.
 */
export async function diagnose(
  input: DiagnosisInput,
  anthropic: AnthropicClient | null,
): Promise<DiagnosisOutput> {
  const heur = runHeuristics(input);
  if (heur) return heur;

  // Sin patrón conocido. Si tenemos cliente Anthropic, llamamos al juez Haiku.
  if (!anthropic) {
    return {
      diagnosis:
        `Se detectaron errores durante la prueba de ${input.featureName} pero no encajan en ningún patrón conocido. ` +
        `Revisa la pestaña Errores de red y consola para identificar la causa.`,
      recommendation: "Inspeccionar manualmente los errores listados antes de decidir.",
      risks: [
        `Estado de ${input.featureName} desconocido: puede estar parcialmente roto.`,
      ],
    };
  }

  const dynamicSuffix = JSON.stringify(
    {
      feature: input.featureName,
      featureUrl: input.featureUrl,
      finalUrl: input.finalUrl,
      failNote: input.failNote,
      blockReason: input.blockReason,
      networkErrors: input.networkErrors.slice(0, 12),
      consoleErrors: input.consoleErrors.slice(0, 5),
    },
    null,
    2,
  );

  try {
    const r = await anthropic.invoke({
      model: "claude-haiku-4-5-20251001",
      staticPrefix:
        `Eres un ingeniero senior diagnosticando bugs de QA. Recibes errores de red y consola ` +
        `de una app web (Next.js + Supabase). Devuelves SIEMPRE JSON estricto con tres claves: ` +
        `"diagnosis" (1-3 frases en español, lenguaje claro, qué pasa y por qué), ` +
        `"recommendation" (1-2 frases con acción concreta para el dev), ` +
        `"risks" (array de 1-3 strings cortas, qué se rompe si se ignora). ` +
        `NO inventes endpoints. Solo razona sobre los datos recibidos.`,
      dynamicSuffix:
        `Errores observados:\n${dynamicSuffix}\n\nResponde SOLO con el JSON, sin texto adicional.`,
      maxTokens: 800,
      includeDefenseBlocks: true,
    });
    const out = anthropic.parseJson<DiagnosisOutput>(r.text);
    return {
      diagnosis: out.diagnosis || "Sin diagnóstico.",
      recommendation: out.recommendation || "Inspeccionar manualmente.",
      risks: Array.isArray(out.risks) ? out.risks : [],
    };
  } catch {
    return {
      diagnosis:
        `Errores detectados en ${input.featureName} pero el diagnóstico automático falló. ` +
        `Inspecciona los errores listados.`,
      recommendation: "Revisar manualmente los errores antes de decidir.",
      risks: [`${input.featureName} puede estar parcialmente roto.`],
    };
  }
}
