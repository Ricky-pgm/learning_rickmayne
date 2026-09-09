"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Badge } from "@/components/ui/badge"
import { Bug, RefreshCw, Trophy, Lightbulb, CheckCircle2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { getApiErrorMessage } from "@/lib/api-errors"
import { recordExerciseAttempt } from "@/lib/study/exercise-history-queries"
import type { StudyChapter } from "@/lib/study/types"
import type { BugHuntChallenge } from "@/lib/study/bug-hunt-prompt"

interface Props {
  chapter: StudyChapter
  /** Voir speed-round.tsx — appelé une fois le bug réellement trouvé. */
  onComplete?: () => void
}

/**
 * Bug Hunt — un extrait de code affiché ligne par ligne, une ligne cache
 * un bug volontaire à trouver en cliquant dessus. Sans chrono (voir
 * decision en session) : le code demande de vraiment lire, un timer
 * pousserait à cliquer au hasard plutôt qu'à analyser — le score se base
 * sur le nombre d'essais, pas la vitesse, dans le même esprit que
 * MemoryMatch (moves) plutôt que SpeedRound (secondsLeft).
 */
export function BugHunt({ chapter, onComplete }: Props) {
  const [challenge, setChallenge] = useState<BugHuntChallenge | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [wrongGuesses, setWrongGuesses] = useState<number[]>([])
  const [foundIndex, setFoundIndex] = useState<number | null>(null)
  const [showHint, setShowHint] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    setWrongGuesses([])
    setFoundIndex(null)
    setShowHint(false)
    try {
      const res = await fetch("/api/study/bug-hunt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapterId: chapter.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Erreur")
      setChallenge(data as BugHuntChallenge)
    } catch (e) {
      setError(getApiErrorMessage(e instanceof Error ? e.message : "Erreur"))
    } finally {
      setLoading(false)
    }
  }, [chapter.id])

  useEffect(() => {
    Promise.resolve().then(() => load())
  }, [load])

  useEffect(() => {
    if (foundIndex !== null) {
      recordExerciseAttempt(chapter.id, "bugHunt", wrongGuesses.length === 0)
      onComplete?.()
    }
  }, [foundIndex, wrongGuesses.length, chapter.id, onComplete])

  function handleLineClick(index: number) {
    if (!challenge || foundIndex !== null || wrongGuesses.includes(index)) return

    if (index === challenge.buggy_line_index) {
      setFoundIndex(index)
    } else {
      setWrongGuesses(prev => [...prev, index])
      // Un indice apparaît après 2 essais ratés — laisse une vraie chance
      // de trouver seul avant d'aider, sans laisser quelqu'un cliquer au
      // hasard indéfiniment.
      if (wrongGuesses.length + 1 >= 2) setShowHint(true)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center py-8 gap-3">
        <Spinner className="size-6 text-primary" />
        <p className="text-sm text-muted-foreground">Préparation du Bug Hunt…</p>
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
        <p className="text-muted-foreground">Aucun défi généré.</p>
      </div>
    )
  }

  const found = foundIndex !== null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Bug className="h-3.5 w-3.5" /> Trouve la ligne fautive
        </span>
        {wrongGuesses.length > 0 && !found && (
          <Badge variant="outline" className="text-xs">
            {wrongGuesses.length} essai{wrongGuesses.length > 1 ? "s" : ""}
          </Badge>
        )}
      </div>

      <Card className="border border-border/70 bg-card shadow-none">
        <CardContent className="p-0">
          <div className="overflow-x-auto rounded-lg font-mono text-xs sm:text-sm">
            {challenge.code_lines.map((line, i) => {
              const isWrong = wrongGuesses.includes(i)
              const isFound = foundIndex === i
              const isClickable = !found

              return (
                <button
                  key={i}
                  onClick={() => handleLineClick(i)}
                  disabled={!isClickable || isWrong}
                  className={cn(
                    "flex w-full items-start gap-3 whitespace-pre px-3 py-1.5 text-left transition-colors",
                    isWrong && "animate-shake-wrong",
                    isFound && "animate-in fade-in zoom-in-95 duration-300",
                    isClickable && !isWrong && "cursor-pointer hover:bg-ring/10",
                    isWrong && "bg-destructive/10 text-destructive line-through decoration-destructive/50",
                    isFound && "bg-success/10 text-success font-medium",
                    !isWrong && !isFound && "text-foreground",
                  )}
                >
                  <span className="select-none text-muted-foreground/40 tabular-nums">{i + 1}</span>
                  <span className="flex-1">{line}</span>
                  {isFound && <Bug className="h-4 w-4 flex-shrink-0" />}
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {showHint && !found && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          <Lightbulb className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <p>{challenge.hint_fr}</p>
        </div>
      )}

      {found && (
        <Card className="border border-success/30 bg-success/5 shadow-none">
          <CardContent className="flex flex-col gap-4 p-5">
            <div className="flex items-center gap-3">
              <div className={cn(
                "flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full",
                wrongGuesses.length === 0 ? "bg-success/10" : "bg-ring/10",
              )}>
                {wrongGuesses.length === 0 ? (
                  <Trophy className="h-6 w-6 text-success" />
                ) : (
                  <CheckCircle2 className="h-6 w-6 text-ring" />
                )}
              </div>
              <div>
                <p className="font-semibold">
                  {wrongGuesses.length === 0 ? "Bug trouvé du premier coup !" : "Bug trouvé !"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {wrongGuesses.length === 0
                    ? "Œil de lynx."
                    : `Trouvé après ${wrongGuesses.length} essai${wrongGuesses.length > 1 ? "s" : ""}.`}
                </p>
              </div>
            </div>

            <div className="space-y-2 border-t border-border/50 pt-3 text-sm">
              <p className="text-foreground">{challenge.explanation_de}</p>
              <p className="text-muted-foreground">{challenge.explanation_fr}</p>
            </div>

            <Button variant="outline" size="sm" className="gap-2 self-start" onClick={load}>
              <RefreshCw className="h-4 w-4" /> Nouveau défi
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
