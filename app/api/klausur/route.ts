import { getCourse } from '@/lib/courses'
import { buildKlausurPrompt } from '@/lib/prompts'
import { isKlausurRelevant } from '@/lib/chapters/types'
import { getApiErrorMessage } from '@/lib/api-errors'
import { parseJsonBody } from '@/lib/api-request'
import { extractTextBlock } from '@/lib/anthropic-response'
import { extractJSON } from '@/lib/study/ai-client'
import { getSupabaseServerClient } from '@/lib/supabase-server'
import { checkAndConsumeAiQuota, RateLimitError } from '@/lib/study/rate-limit'

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: getApiErrorMessage('ANTHROPIC_API_KEY') },
      { status: 500 }
    )
  }

  // Cette route (mode Klausur, legacy) n'avait aucune limite — un compte
  // authentifié pouvait déclencher un nombre illimité d'appels Sonnet à
  // 8000 tokens de sortie chacun. Même garde que /api/study/* (audit
  // sécurité).
  try {
    await checkAndConsumeAiQuota(await getSupabaseServerClient(), 'heavy')
  } catch (e) {
    if (e instanceof RateLimitError) return Response.json({ error: e.message }, { status: 429 })
    throw e
  }

  const body = await parseJsonBody<{ courseId?: string; variantNumber?: number }>(req)
  const { courseId, variantNumber } = body ?? {}
  const course = courseId ? getCourse(courseId) : null
  if (!course) return Response.json({ error: 'Cours non trouvé' }, { status: 404 })

  const klausurChapters = course.chapters.filter(isKlausurRelevant)
  if (klausurChapters.length === 0) {
    return Response.json({ error: "Le mode Klausur n'est pas disponible pour ce cours." }, { status: 400 })
  }

  const prompt = buildKlausurPrompt(klausurChapters, variantNumber ?? 1)

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }]
    })
  })

  const data = await res.json()
  if (!res.ok) {
    return Response.json(
      { error: data.error?.message ?? 'Erreur Anthropic' },
      { status: res.status }
    )
  }

  const text = extractTextBlock(data.content)
  if (!text.includes('{') || !text.includes('}')) {
    return Response.json({ error: 'Réponse invalide' }, { status: 500 })
  }

  // extractJSON (au lieu d'un JSON.parse brut, comme avant) : même repli
  // que /api/study/* pour un caractère de contrôle brut ou une virgule
  // traînante dans la réponse — voir lib/study/ai-client.ts (audit
  // sécurité, ce même bug avait déjà été trouvé deux fois côté /etude).
  try {
    const klausur = extractJSON(text)
    return Response.json(klausur)
  } catch (e) {
    return Response.json({ error: `JSON invalide reçu de l'IA : ${e instanceof Error ? e.message : String(e)}` }, { status: 500 })
  }
}
