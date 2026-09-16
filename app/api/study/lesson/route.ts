import { buildDetailedLessonPrompt, type DetailedLesson } from '@/lib/study/lesson-prompt'
import { getApiErrorMessage } from '@/lib/api-errors'
import { parseJsonBody } from '@/lib/api-request'
import { callClaude, extractJSON, ClaudeApiError } from '@/lib/study/ai-client'
import { getChapterForPrompt } from '@/lib/study/get-chapter-for-prompt'
import { getSupabaseServerClient } from '@/lib/supabase-server'
import { checkAndConsumeAiQuota, RateLimitError } from '@/lib/study/rate-limit'

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: getApiErrorMessage('ANTHROPIC_API_KEY') },
      { status: 500 }
    )
  }

  const body = await parseJsonBody<{ chapterId?: string }>(req)
  const chapterId = body?.chapterId
  if (!chapterId || typeof chapterId !== 'string') {
    return Response.json({ error: 'chapterId manquant' }, { status: 400 })
  }

  try {
    await checkAndConsumeAiQuota(await getSupabaseServerClient(), 'heavy')
  } catch (e) {
    if (e instanceof RateLimitError) return Response.json({ error: e.message }, { status: 429 })
    throw e
  }

  // Résolu via RLS — voir get-chapter-for-prompt.ts pour le contexte
  // (avant : chapitre entier envoyé par le client, sans authentification).
  const chapter = await getChapterForPrompt(chapterId)
  if (!chapter) {
    return Response.json({ error: 'Chapitre introuvable ou accès refusé' }, { status: 404 })
  }

  const prompt = buildDetailedLessonPrompt(chapter)

  try {
    // Génération structurée (sections/exemples/pièges), pas un problème de
    // raisonnement — voir ai-client.ts et ingest/route.ts pour la mesure.
    const model = 'claude-sonnet-5'
    const text = await callClaude({ model, prompt, maxTokens: 6000, effort: 'medium' })
    const lesson = extractJSON(text) as DetailedLesson
    // model voyage avec la leçon jusqu'au client, qui le repasse à
    // saveLessonToCache — study_lessons_cache.model est not null (voir
    // docs/db-anpassung.md §3) et rien d'autre ici ne connaît le modèle
    // réellement utilisé pour cette génération.
    return Response.json({ ...lesson, model })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[study/lesson]', message)
    return Response.json({ error: message }, { status: e instanceof ClaudeApiError ? e.status : 500 })
  }
}
