"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Badge } from "@/components/ui/badge"
import { CodeBlock } from "@/components/code-block"
import { Zap, Flame, RefreshCw, Trophy, CheckCircle, XCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { getApiErrorMessage } from "@/lib/api-errors"
import { recordExerciseAttempt } from "@/lib/study/exercise-history-queries"
import type { StudyChapter } from "@/lib/study/types"
import type { SpeedRoundQuestion } from "@/lib/study/speed-round-prompt"
import type { Lang } from "@/lib/chapters/types"

interface Props {
  chapter: StudyChapter
  lang: Lang
}

// 12s se voulait "speed" mais ne laissait pas le temps de lire l'énoncé
// ET les 3-4 options avant de choisir sur une question technique — 18s
// garde la pression du chrono sans transformer l'exercice en réflexe pur.
const SECONDS_PER_QUESTION = 18

interface ShuffledQuestion extends SpeedRoundQuestion {
  options: string[]
  correctIndex: number
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function prepareQuestions(questions: SpeedRoundQuestion[]): ShuffledQuestion[] {
  return questions.map(q => {
    const options = shuffle([q.answer, ...q.distractors])
    return { ...q, options, correctIndex: options.indexOf(q.answer) }
  })
}

export function SpeedRound({ chapter, lang }: Props) {
  const [questions, setQuestions] = useState<ShuffledQuestion[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [index, setIndex] = useState(0)
  const [score, setScore] = useState(0)
  const [streak, setStreak] = useState(0)
  const [bestStreak, setBestStreak] = useState(0)
  const [secondsLeft, setSecondsLeft] = useState(SECONDS_PER_QUESTION)
  const [selected, setSelected] = useState<number | null>(null)
  const [finished, setFinished] = useState(false)
  const [answers, setAnswers] = useState<(boolean | null)[]>([])
  // Incrémenté à chaque bonne réponse — clé React pour rejouer le "+1"
  // flottant même sur des coups consécutifs (un nouveau montage à chaque
  // fois, plutôt qu'un booléen qui ne rejouerait pas l'animation deux fois
  // de suite sans repasser par false entre les deux).
  const [pointsPulseKey, setPointsPulseKey] = useState<number | null>(null)

  const loadQuestions = useCallback(async () => {
    setLoading(true)
    setError("")
    setIndex(0)
    setScore(0)
    setStreak(0)
    setBestStreak(0)
    setFinished(false)
    setSelected(null)
    setAnswers([])
    try {
      const res = await fetch('/api/study/speed-round', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapterId: chapter.id })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erreur')
      setQuestions(prepareQuestions(data.questions))
      setSecondsLeft(SECONDS_PER_QUESTION)
    } catch (e) {
      setError(getApiErrorMessage(e instanceof Error ? e.message : 'Erreur'))
    } finally {
      setLoading(false)
    }
  }, [chapter.id])

  useEffect(() => {
    Promise.resolve().then(() => loadQuestions())
  }, [loadQuestions])

  const current = useMemo(() => questions?.[index] ?? null, [questions, index])

  const handleAnswer = useCallback((optionIndex: number | null) => {
    if (!current || selected !== null) return
    setSelected(optionIndex)
    const correct = optionIndex === current.correctIndex
    setAnswers(prev => [...prev, correct])
    if (correct) {
      setScore(s => s + 1)
      setStreak(s => {
        const next = s + 1
        setBestStreak(b => Math.max(b, next))
        return next
      })
      setPointsPulseKey(k => (k ?? 0) + 1)
    } else {
      setStreak(0)
    }
    // Best-effort, ne bloque jamais la réponse affichée à l'utilisateur —
    // alimente pickNextExercise (lib/study/next-up.ts).
    recordExerciseAttempt(chapter.id, "speedRound", correct)
  }, [current, selected, chapter.id])

  useEffect(() => {
    if (!current || selected !== null || finished) return
    if (secondsLeft <= 0) {
      Promise.resolve().then(() => handleAnswer(null))
      return
    }
    const timer = setTimeout(() => setSecondsLeft(s => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [secondsLeft, current, selected, finished, handleAnswer])

  // Démonte le "+1" flottant après son animation — sinon il reste figé
  // visible dans son état final plutôt que de vraiment disparaître.
  useEffect(() => {
    if (pointsPulseKey === null) return
    const timer = setTimeout(() => setPointsPulseKey(null), 700)
    return () => clearTimeout(timer)
  }, [pointsPulseKey])

  function next() {
    if (!questions) return
    if (index + 1 >= questions.length) {
      setFinished(true)
      return
    }
    setIndex(i => i + 1)
    setSelected(null)
    setSecondsLeft(SECONDS_PER_QUESTION)
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center py-8 gap-3">
        <Spinner className="size-6 text-primary" />
        <p className="text-sm text-muted-foreground">Préparation du Speed Round…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={loadQuestions}>
          Réessayer
        </Button>
      </div>
    )
  }

  if (!questions || questions.length === 0) {
    return (
      <div className="rounded-lg border border-border/70 bg-card p-8 text-center">
        <p className="text-muted-foreground">Aucune question générée.</p>
      </div>
    )
  }

  if (finished) {
    const correctCount = answers.filter(a => a === true).length
    const pct = Math.round((correctCount / questions.length) * 100)
    const isPerfect = correctCount === questions.length

    return (
      <Card className="border border-ring/30 bg-ring/5 shadow-none">
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          <div className={cn(
            "flex h-16 w-16 items-center justify-center rounded-full",
            isPerfect ? "bg-success/10" : "bg-ring/10",
          )}>
            {isPerfect ? (
              <Trophy className="h-8 w-8 text-success" />
            ) : (
              <Zap className="h-8 w-8 text-ring" />
            )}
          </div>

          <div>
            <p className="text-xl font-semibold">
              {isPerfect ? "Score parfait !" : "Speed Round terminé"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {correctCount}/{questions.length} correctes ({pct}%)
            </p>
          </div>

          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1.5">
              <Flame className="h-4 w-4 text-warning" />
              <span>Meilleure série : {bestStreak}</span>
            </div>
          </div>

          {/* Answer summary */}
          <div className="flex items-center gap-1">
            {answers.map((correct, i) => (
              <div
                key={i}
                className={cn(
                  "h-2 w-2 rounded-full",
                  correct ? "bg-success" : "bg-destructive",
                )}
              />
            ))}
          </div>

          <Button variant="outline" size="sm" className="mt-2 gap-2" onClick={loadQuestions}>
            <RefreshCw className="h-4 w-4" /> Rejouer
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (!current) return null

  const timerProgress = (secondsLeft / SECONDS_PER_QUESTION) * 100
  const isLowTime = secondsLeft <= 3

  return (
    <div className="space-y-4">
      {/* Header with progress */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            {index + 1} / {questions.length}
          </span>
          <div className="flex items-center gap-3">
            {streak > 1 && (
              <Badge variant="outline" className="text-xs border-warning/40 text-warning gap-1">
                <Flame className="h-3 w-3" /> {streak}
              </Badge>
            )}
            <span className="relative font-mono tabular-nums font-medium">
              {score} pts
              {pointsPulseKey !== null && (
                <span
                  key={pointsPulseKey}
                  className="pointer-events-none absolute -top-3.5 left-1/2 -translate-x-1/2 animate-in fade-in slide-in-from-bottom-2 text-success font-semibold duration-500"
                >
                  +1
                </span>
              )}
            </span>
          </div>
        </div>
        {/* Timer bar */}
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-1000 ease-linear",
              isLowTime ? "bg-destructive" : "bg-ring",
            )}
            style={{ width: `${timerProgress}%` }}
          />
        </div>
        <p className={cn(
          "text-center text-xs font-mono tabular-nums",
          isLowTime ? "text-destructive font-medium" : "text-muted-foreground",
        )}>
          {secondsLeft}s
        </p>
      </div>

      {/* Question card */}
      <Card className="border border-border/70 bg-card shadow-none">
        <CardContent className="space-y-4 p-4 sm:p-5">
          <p className="text-lg font-semibold">{current.question}</p>
          {current.code && lang !== 'none' && <CodeBlock code={current.code} lang={lang} />}

          {/* Answer options */}
          <div className="grid gap-2 sm:grid-cols-2">
            {current.options.map((option, i) => {
              const isCorrect = i === current.correctIndex
              const isSelected = i === selected
              const revealed = selected !== null

              return (
                <button
                  key={i}
                  onClick={() => handleAnswer(i)}
                  disabled={revealed}
                  className={cn(
                    "rounded-lg border px-3 py-2.5 text-left text-sm transition-all duration-200",
                    !revealed && "border-border hover:border-ring/40 hover:bg-muted/40",
                    revealed && isCorrect && "scale-[1.02] border-success/40 bg-success/10 text-success font-medium shadow-sm",
                    revealed && isSelected && !isCorrect && "border-destructive/40 bg-destructive/10 text-destructive",
                    revealed && !isCorrect && !isSelected && "border-border/50 opacity-50",
                  )}
                >
                  <span className="flex items-center gap-2">
                    {revealed && isCorrect && <CheckCircle className="h-4 w-4 flex-shrink-0" />}
                    {revealed && isSelected && !isCorrect && <XCircle className="h-4 w-4 flex-shrink-0" />}
                    {option}
                  </span>
                </button>
              )
            })}
          </div>

          {selected !== null && (
            <Button onClick={next} className="w-full">
              {index + 1 >= questions.length ? "Voir le résultat" : "Question suivante"}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
