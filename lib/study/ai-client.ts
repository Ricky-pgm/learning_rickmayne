import { extractTextBlock } from "@/lib/anthropic-response"

// claude-sonnet-4-6 n'est pas utilisé côté mode étude (seulement par le
// mode Klausur, app/api/klausur|exercise|lesson) — gardé ici uniquement si
// ce fichier est un jour partagé entre les deux modes.
type ClaudeModel = "claude-sonnet-5" | "claude-sonnet-4-6" | "claude-haiku-4-5"

type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max"

interface CallClaudeOptions {
  model: ClaudeModel
  prompt: string
  maxTokens?: number
  /** Sonnet 5 uniquement — Haiku 4.5 n'a pas de paramètre effort (erreur si
   * envoyé). Une extraction/génération structurée n'a pas besoin du
   * raisonnement par défaut de Sonnet 5, qui ajoute des tokens de sortie
   * facturés sans changer le résultat — voir ingest/route.ts pour la
   * mesure (thinking_tokens: 0 à "medium", même qualité de résultat). */
  effort?: EffortLevel
}

/** Porte le status HTTP Anthropic d'origine (ex. 429 rate-limit, 401 clé
 * invalide) — sans ça, l'appelant ne peut renvoyer qu'un 500 générique quel
 * que soit le vrai problème. */
export class ClaudeApiError extends Error {
  constructor(message: string, public status: number) {
    super(message)
    this.name = "ClaudeApiError"
  }
}

export async function callClaude({ model, prompt, maxTokens = 2000, effort }: CallClaudeOptions): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY manquante")

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      ...(effort ? { output_config: { effort } } : {}),
      messages: [{ role: "user", content: prompt }],
    }),
  })

  const data = await res.json()
  if (!res.ok) throw new ClaudeApiError(data.error?.message ?? "Erreur Anthropic", res.status)

  return extractTextBlock(data.content)
}

/**
 * Neutralise les caractères de contrôle bruts (retour à la ligne, tab...)
 * quand ils apparaissent À L'INTÉRIEUR d'une chaîne JSON — Claude en
 * insère parfois dans un exemple de code multi-ligne au lieu de les
 * échapper en \n, ce que JSON.parse refuse (erreur "Bad control character
 * in string literal"). On ne touche qu'aux caractères entre guillemets non
 * échappés, jamais à la structure JSON elle-même (les vrais retours à la
 * ligne de mise en forme, hors chaînes, restent intacts).
 */
function sanitizeControlCharsInStrings(text: string): string {
  let out = ""
  let inString = false
  let escaped = false
  for (const ch of text) {
    if (inString) {
      if (escaped) {
        out += ch
        escaped = false
      } else if (ch === "\\") {
        out += ch
        escaped = true
      } else if (ch === '"') {
        out += ch
        inString = false
      } else if (ch === "\n") {
        out += "\\n"
      } else if (ch === "\r") {
        out += "\\r"
      } else if (ch === "\t") {
        out += "\\t"
      } else {
        out += ch
      }
    } else {
      out += ch
      if (ch === '"') inString = true
    }
  }
  return out
}

/** Virgules traînantes avant `}` ou `]` — invalides en JSON strict, mais un
 * modèle qui a appris JS/JSON5 en glisse occasionnellement une. */
function stripTrailingCommas(text: string): string {
  return text.replace(/,(\s*[}\]])/g, "$1")
}

export function extractJSON(text: string): unknown {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end === -1) throw new Error("Pas de JSON trouvé dans la réponse IA")
  const raw = text.slice(start, end + 1)

  try {
    return JSON.parse(raw)
  } catch {
    // Repli en deux passes plutôt qu'un échec immédiat : la plupart des
    // erreurs observées (caractère de contrôle, virgule manquante) sont
    // des défauts de formatage isolés, pas un JSON réellement tronqué —
    // pas besoin de rappeler l'API pour ça.
    try {
      return JSON.parse(stripTrailingCommas(sanitizeControlCharsInStrings(raw)))
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      throw new Error(`JSON invalide dans la réponse IA (${detail})`)
    }
  }
}
