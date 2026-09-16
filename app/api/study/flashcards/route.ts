import { buildFlashcardPrompt } from '@/lib/study/flashcard-prompt'
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
    await checkAndConsumeAiQuota(await getSupabaseServerClient(), 'light')
  } catch (e) {
    if (e instanceof RateLimitError) return Response.json({ error: e.message }, { status: 429 })
    throw e
  }

  // Résolu via RLS — la route n'accepte plus le contenu du chapitre tel
  // quel depuis le client (n'importe qui pouvait inventer un chapitre et
  // déclencher un appel Anthropic payant sans compte). Ici, un chapitre
  // introuvable ou n'appartenant pas à l'appelant renvoie le même 404 —
  // pas de session valide donne systématiquement ce résultat.
  const chapter = await getChapterForPrompt(chapterId)
  if (!chapter) {
    return Response.json({ error: 'Chapitre introuvable ou accès refusé' }, { status: 404 })
  }

  const prompt = buildFlashcardPrompt(chapter)

  try {
    const text = await callClaude({ model: 'claude-haiku-4-5', prompt, maxTokens: 3000 })
    const parsed = extractJSON(text)
    return Response.json(parsed)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[study/flashcards]', message)
    return Response.json({ error: message }, { status: e instanceof ClaudeApiError ? e.status : 500 })
  }
}
