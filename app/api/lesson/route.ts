import { getChapter } from '@/lib/courses'
import { getLangLabel } from '@/lib/lang'
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

  // Cette route (mode Klausur, legacy) n'avait aucune limite — même garde
  // que /api/study/* (audit sécurité).
  try {
    await checkAndConsumeAiQuota(await getSupabaseServerClient(), 'heavy')
  } catch (e) {
    if (e instanceof RateLimitError) return Response.json({ error: e.message }, { status: 429 })
    throw e
  }

  const body = await parseJsonBody<{ courseId?: string; chapterId?: number }>(req)
  const { courseId, chapterId } = body ?? {}
  const chapter = courseId && chapterId !== undefined ? getChapter(courseId, chapterId) : null
  if (!chapter) return Response.json({ error: 'Chapitre non trouvé' }, { status: 404 })

  const langLabel = getLangLabel(chapter.lang)
  const hasCode = chapter.hasCode !== false

  const prompt = `Tu es un professeur ${langLabel} expert. Génère un mini-cours de révision très concis (3 minutes maximum) sur le chapitre "${chapter.de}" (${chapter.fr}).

Concepts clés à couvrir : ${chapter.concepts.join(', ')}
Résumé du chapitre : ${chapter.summary}

Le cours doit être utile pour un étudiant francophone qui passe un examen en Allemagne.
Reste court: exactement 2 sections maximum, ${hasCode ? '1 exemple de code maximum' : 'aucun exemple de code'}, phrases directes, pas de développement long.
${hasCode ? '' : 'Ce chapitre a KEINEN Code: le champ "code" doit toujours être null et les exemples doivent porter sur des concepts, définitions, méthodes et outils.'}

Antworte AUSSCHLIESSLICH mit gültigem JSON. Kein Markdown, keine Backticks.

{
  "title_de": "Titre du cours en allemand",
  "intro_fr": "Introduction courte en français (1 phrase) expliquant l'importance de ce chapitre",
  "sections": [
    {
      "heading_de": "Titre de section en allemand",
      "content_de": "Explication en allemand (1-2 phrases, vocabulaire d'examen)",
      "content_fr": "Même explication en français (1-2 phrases)",
      "code": ${hasCode ? `"Exemple de code ${langLabel} illustratif (ou null si pas pertinent)"` : "null"}
    }
  ],
  "key_points_de": ["Point clé 1 en allemand", "Point clé 2"],
  "traps": [
    {
      "trap_de": "Piège fréquent en allemand",
      "trap_fr": "Explication du piège en français"
    }
  ]
}`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1600,
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
  // que /api/study/* — voir lib/study/ai-client.ts.
  try {
    const lesson = extractJSON(text)
    return Response.json(lesson)
  } catch (e) {
    return Response.json({ error: `JSON invalide reçu de l'IA : ${e instanceof Error ? e.message : String(e)}` }, { status: 500 })
  }
}
