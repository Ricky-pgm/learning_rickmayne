import { getApiErrorMessage } from "@/lib/api-errors"
import { parseJsonBody } from "@/lib/api-request"
import { callClaude, extractJSON, ClaudeApiError, type EffortLevel } from "@/lib/study/ai-client"
import { getChapterForPrompt, type PromptChapter } from "@/lib/study/get-chapter-for-prompt"
import { getSupabaseServerClient } from "@/lib/supabase-server"
import { checkAndConsumeAiQuota, RateLimitError, type AiUsageCategory } from "@/lib/study/rate-limit"

/**
 * Les 7 routes /api/study/{flashcards,speed-round,bug-hunt,code-complete,
 * concept-map,lesson,fill-blank} partageaient exactement la même
 * structure (clé API -> body -> quota -> résolution du chapitre via RLS ->
 * prompt -> appel Claude -> extractJSON -> erreurs), à ~45 lignes
 * identiques chacune, seuls le prompt/modèle/quota variant réellement —
 * audit sécurité, D-4. Un seul point pour ce squelette plutôt que 7 copies
 * à maintenir en parallèle (le bug JSON.parse trouvé deux fois pendant
 * l'audit, F-1/F-2, est exactement le genre d'oubli que la duplication
 * favorise).
 */
export interface GenerationRouteConfig<TResult = unknown> {
  logLabel: string
  quotaCategory: AiUsageCategory
  model: "claude-sonnet-5" | "claude-haiku-4-5"
  maxTokens: number
  effort?: EffortLevel
  buildPrompt: (chapter: PromptChapter) => string
  /** true si l'exercice n'a de sens que pour un chapitre avec du code (bug-hunt, code-complete). */
  requiresCode?: boolean
  /** Transforme le JSON extrait avant de le renvoyer au client (ex. lesson ajoute `model`). */
  transformResult?: (parsed: unknown, chapter: PromptChapter) => TResult
}

export function createGenerationRoute(config: GenerationRouteConfig) {
  return async function POST(req: Request) {
    if (!process.env.ANTHROPIC_API_KEY) {
      return Response.json(
        { error: getApiErrorMessage("ANTHROPIC_API_KEY") },
        { status: 500 }
      )
    }

    const body = await parseJsonBody<{ chapterId?: string }>(req)
    const chapterId = body?.chapterId
    if (!chapterId || typeof chapterId !== "string") {
      return Response.json({ error: "chapterId manquant" }, { status: 400 })
    }

    try {
      await checkAndConsumeAiQuota(await getSupabaseServerClient(), config.quotaCategory)
    } catch (e) {
      if (e instanceof RateLimitError) return Response.json({ error: e.message }, { status: 429 })
      throw e
    }

    const chapter = await getChapterForPrompt(chapterId)
    if (!chapter) {
      return Response.json({ error: "Chapitre introuvable ou accès refusé" }, { status: 404 })
    }

    if (config.requiresCode && !chapter.has_code) {
      return Response.json(
        { error: "Ce type d'exercice n'est pas disponible pour ce chapitre." },
        { status: 400 }
      )
    }

    const prompt = config.buildPrompt(chapter)

    try {
      const text = await callClaude({
        model: config.model,
        prompt,
        maxTokens: config.maxTokens,
        effort: config.effort,
      })
      const parsed = extractJSON(text)
      const result = config.transformResult ? config.transformResult(parsed, chapter) : parsed
      return Response.json(result)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.error(`[${config.logLabel}]`, message)
      return Response.json({ error: message }, { status: e instanceof ClaudeApiError ? e.status : 500 })
    }
  }
}
