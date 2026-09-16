import { buildCodeCompletePrompt } from '@/lib/study/code-complete-prompt'
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

  const chapter = await getChapterForPrompt(chapterId)
  if (!chapter) {
    return Response.json({ error: 'Chapitre introuvable ou accès refusé' }, { status: 404 })
  }

  // Comme bug-hunt : n'a de sens que pour du code, protégé aussi côté
  // serveur même si l'UI ne l'affiche déjà que pour has_code.
  if (!chapter.has_code) {
    return Response.json(
      { error: "Ce type d'exercice n'est pas disponible pour ce chapitre." },
      { status: 400 }
    )
  }

  const prompt = buildCodeCompletePrompt(chapter)

  try {
    const text = await callClaude({ model: 'claude-haiku-4-5', prompt, maxTokens: 2000 })
    const parsed = extractJSON(text)
    return Response.json(parsed)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[study/code-complete]', message)
    return Response.json({ error: message }, { status: e instanceof ClaudeApiError ? e.status : 500 })
  }
}
