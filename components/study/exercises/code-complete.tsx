"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Code2, RefreshCw, Trophy, CheckCircle2, XCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { getApiErrorMessage } from "@/lib/api-errors"
import { recordExerciseAttempt } from "@/lib/study/exercise-history-queries"
import type { StudyChapter } from "@/lib/study/types"
import type { CodeCompleteChallenge } from "@/lib/study/code-complete-prompt"

interface Props {
  chapter: StudyChapter
  /** Voir speed-round.tsx — appelé une fois la bonne ligne trouvée. */
  onComplete?: () => void
}

/**
 * Complète le code — une ligne clé retirée d'un extrait, à choisir parmi
 * plusieurs propositions plausibles. Complémentaire à BugHunt : là on
 * repère une ligne fautive dans du code déjà complet, ici on choisit la
 * bonne ligne pour compléter un trou. Sans chrono, score au nombre
 * d'essais, cohérent avec les autres mini-jeux sans pression de temps.
 */
export function CodeComplete({ chapter, onComplete }: Props) {
  const [challenge, setChallenge] = useState<CodeCompleteChallenge | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [selected, setSelected] = useState<number | null>(null)
  const [wrongIndices, setWrongIndices] = useState<number[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    setSelected(null)
    setWrongIndices([])
    try {
      const res = await fetch("/api/study/code-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapterId: chapter.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Erreur")
      setChallenge(data as CodeCompleteChallenge)
    } catch (e) {
      setError(getApiErrorMessage(e instanceof Error ? e.message : "Erreur"))
    } finally {
      setLoading(false)
    }
  }, [chapter.id])

  useEffect(() => {
    Promise.resolve().then(() => load())
  }, [load])

  const solved = selected !== null

  useEffect(() => {
    if (solved) {
      recordExerciseAttempt(chapter.id, "code", wrongIndices.length === 0)
      onComplete?.()
    }
  }, [solved, wrongIndices.length, chapter.id, onComplete])

  function handleOptionClick(index: number) {
    if (!challenge || solved || wrongIndices.includes(index)) return

    if (index === challenge.correct_index) {
      setSelected(index)
    } else {
      setWrongIndices(prev => [...prev, index])
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center py-8 gap-3">
        <Spinner className="size-6 text-primary" />
        <p className="text-sm text-muted-foreground">Préparation de l&apos;exercice…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={load}>
          Réessayer
        </Button>
      </div>
    )
  }

  if (!challenge) {
    return (
      <div className="rounded-lg border border-border/70 bg-card p-8 text-center">
        <p className="text-muted-foreground">Aucun exercice généré.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Code2 className="h-3.5 w-3.5" /> Complète la ligne manquante
      </div>

      <Card className="border border-border/70 bg-card shadow-none">
        <CardContent className="overflow-x-auto p-0">
          <div className="font-mono text-xs sm:text-sm">
            {challenge.code_before.map((line, i) => (
              <div key={`before-${i}`} className="flex items-start gap-3 whitespace-pre px-3 py-1.5">
                <span className="select-none text-muted-foreground/40 tabular-nums">{i + 1}</span>
                <span className="flex-1">{line}</span>
              </div>
            ))}
            <div className="flex items-start gap-3 whitespace-pre bg-accent-brand/5 px-3 py-1.5">
              <span className="select-none text-muted-foreground/40 tabular-nums">{challenge.code_before.length + 1}</span>
              <span className={cn(
                "flex-1 font-medium",
                solved ? "animate-in fade-in zoom-in-95 text-success duration-300" : "text-accent-brand",
              )}>
                {solved ? challenge.options[challenge.correct_index] : "// ?"}
              </span>
            </div>
            {challenge.code_after.map((line, i) => (
              <div key={`after-${i}`} className="flex items-start gap-3 whitespace-pre px-3 py-1.5">
                <span className="select-none text-muted-foreground/40 tabular-nums">
                  {challenge.code_before.length + 2 + i}
                </span>
                <span className="flex-1">{line}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {!solved && (
        <div className="grid gap-2 sm:grid-cols-2">
          {challenge.options.map((option, i) => {
            const isWrong = wrongIndices.includes(i)
            return (
              <button
                key={i}
                onClick={() => handleOptionClick(i)}
                disabled={isWrong}
                className={cn(
                  "rounded-lg border px-3 py-2.5 text-left font-mono text-xs transition-all sm:text-sm",
                  isWrong
                    ? "animate-shake-wrong border-destructive/40 bg-destructive/10 text-destructive line-through decoration-destructive/50"
                    : "border-border hover:border-accent-brand/40 hover:bg-muted/40",
                )}
              >
                <span className="flex items-center gap-2">
                  {isWrong && <XCircle className="h-3.5 w-3.5 flex-shrink-0" />}
                  {option}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {solved && (
        <Card className="border border-success/30 bg-success/5 shadow-none">
          <CardContent className="flex flex-col gap-4 p-5">
            <div className="flex items-center gap-3">
              <div className={cn(
                "flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full",
                wrongIndices.length === 0 ? "bg-success/10" : "bg-accent-brand/10",
              )}>
                {wrongIndices.length === 0 ? (
                  <Trophy className="h-6 w-6 text-success" />
                ) : (
                  <CheckCircle2 className="h-6 w-6 text-accent-brand" />
                )}
              </div>
              <div>
                <p className="font-semibold">
                  {wrongIndices.length === 0 ? "Complété du premier coup !" : "Complété !"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {wrongIndices.length === 0
                    ? "Bien joué."
                    : `Trouvé après ${wrongIndices.length} essai${wrongIndices.length > 1 ? "s" : ""}.`}
                </p>
              </div>
            </div>

            <div className="space-y-2 border-t border-border/50 pt-3 text-sm">
              <p className="text-foreground">{challenge.explanation_de}</p>
              <p className="text-muted-foreground">{challenge.explanation_fr}</p>
            </div>

            <Button variant="outline" size="sm" className="gap-2 self-start" onClick={load}>
              <RefreshCw className="h-4 w-4" /> Nouvel exercice
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
