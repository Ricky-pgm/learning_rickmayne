"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Badge } from "@/components/ui/badge"
import { PenLine, RefreshCw, Trophy, CheckCircle2, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { getApiErrorMessage } from "@/lib/api-errors"
import { recordExerciseAttempt } from "@/lib/study/exercise-history-queries"
import type { StudyChapter } from "@/lib/study/types"
import type { FillBlankChallenge } from "@/lib/study/fill-blank-prompt"

interface Props {
  chapter: StudyChapter
  /** Voir speed-round.tsx — appelé une fois le texte complété SANS erreur
   * (finished ici, pas "checked" : un premier essai raté ne compte pas
   * comme la phase "S'entraîner" terminée, seul un texte réussi compte). */
  onComplete?: () => void
}

type Segment = { type: "text"; value: string } | { type: "blank"; index: number }

// Découpe "Le [1] permet de [2]." en segments texte/trou — évite une
// saisie libre côté utilisateur (voir fill-blank-prompt.ts) : cliquer une
// étiquette puis un trou, comme ConceptMap clique deux nœuds.
function parseTemplate(template: string): Segment[] {
  const parts = template.split(/(\[\d+\])/g)
  return parts
    .filter(p => p.length > 0)
    .map(p => {
      const m = p.match(/^\[(\d+)\]$/)
      return m ? { type: "blank" as const, index: Number(m[1]) - 1 } : { type: "text" as const, value: p }
    })
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/**
 * Texte à trous — étiquettes à placer dans les blancs d'une explication
 * courte, en cliquant une étiquette puis un trou. Placer tous les mots
 * puis vérifier à la fin (bouton "Vérifier"), plutôt qu'une correction
 * trou par trou : ça laisse le temps de remplir normalement et de changer
 * d'avis (recliquer un trou rempli le libère) avant de savoir si c'est
 * bon, au lieu de sanctionner chaque choix dans l'instant.
 */
export function FillBlank({ chapter, onComplete }: Props) {
  const [challenge, setChallenge] = useState<FillBlankChallenge | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [pool, setPool] = useState<string[]>([])
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [placed, setPlaced] = useState<Record<number, string>>({})
  // Devient true seulement après avoir cliqué "Vérifier" — avant ça, un
  // trou rempli ne révèle rien sur sa justesse, il reste neutre.
  const [checked, setChecked] = useState(false)
  const [attempts, setAttempts] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    setSelectedTag(null)
    setPlaced({})
    setChecked(false)
    setAttempts(0)
    try {
      const res = await fetch("/api/study/fill-blank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapterId: chapter.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Erreur")
      const parsed = data as FillBlankChallenge
      setChallenge(parsed)
      setPool(shuffle([...parsed.blanks, ...parsed.distractors]))
    } catch (e) {
      setError(getApiErrorMessage(e instanceof Error ? e.message : "Erreur"))
    } finally {
      setLoading(false)
    }
  }, [chapter.id])

  useEffect(() => {
    Promise.resolve().then(() => load())
  }, [load])

  const segments = useMemo(() => (challenge ? parseTemplate(challenge.text_template) : []), [challenge])
  const totalBlanks = challenge?.blanks.length ?? 0
  const allPlaced = totalBlanks > 0 && Object.keys(placed).length === totalBlanks
  const correctCount = useMemo(() => {
    if (!challenge) return 0
    return Object.entries(placed).filter(([index, tag]) => challenge.blanks[Number(index)] === tag).length
  }, [challenge, placed])
  const finished = checked && correctCount === totalBlanks

  useEffect(() => {
    if (checked) {
      recordExerciseAttempt(chapter.id, "fillBlank", correctCount === totalBlanks)
      if (correctCount === totalBlanks) onComplete?.()
    }
  }, [checked, correctCount, totalBlanks, chapter.id, onComplete])

  function handleTagClick(tag: string) {
    if (checked) return
    setSelectedTag(prev => (prev === tag ? null : tag))
  }

  // Un trou vide reçoit l'étiquette sélectionnée ; un trou déjà rempli se
  // libère et remet son étiquette dans le pool — permet de changer d'avis
  // avant de vérifier, plutôt que d'être bloqué sur un premier choix.
  function handleBlankClick(index: number) {
    if (!challenge || checked) return

    if (placed[index]) {
      const tag = placed[index]
      setPlaced(prev => {
        const next = { ...prev }
        delete next[index]
        return next
      })
      setPool(prev => [...prev, tag])
      return
    }

    if (!selectedTag) return
    setPlaced(prev => ({ ...prev, [index]: selectedTag }))
    setPool(prev => prev.filter(t => t !== selectedTag))
    setSelectedTag(null)
  }

  function handleCheck() {
    if (!allPlaced) return
    setAttempts(a => a + 1)
    setChecked(true)
  }

  // Réessayer après une vérification ratée : ne remet en jeu que les
  // trous incorrects, les bons restent acquis — sans ça, revenir en
  // arrière effacerait aussi le travail déjà validé.
  function handleRetry() {
    if (!challenge) return
    const stillWrong = Object.entries(placed).filter(([index, tag]) => challenge.blanks[Number(index)] !== tag)
    const wrongTags = stillWrong.map(([, tag]) => tag)
    setPlaced(prev => {
      const next = { ...prev }
      for (const [index] of stillWrong) delete next[Number(index)]
      return next
    })
    setPool(prev => [...prev, ...wrongTags])
    setChecked(false)
    setSelectedTag(null)
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center py-8 gap-3">
        <Spinner className="size-6 text-primary" />
        <p className="text-sm text-muted-foreground">Préparation du texte à trous…</p>
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

  if (!challenge || challenge.blanks.length === 0) {
    return (
      <div className="rounded-lg border border-border/70 bg-card p-8 text-center">
        <p className="text-muted-foreground">Aucun texte généré.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <PenLine className="h-3.5 w-3.5" /> {Object.keys(placed).length} / {totalBlanks} trous remplis
        </span>
        {checked && (
          <Badge variant="outline" className={cn("text-xs", correctCount === totalBlanks ? "border-success/40 text-success" : "border-warning/40 text-warning")}>
            {correctCount} / {totalBlanks} corrects
          </Badge>
        )}
      </div>

      <Card className="border border-border/70 bg-card shadow-none">
        <CardContent className="p-4 sm:p-5">
          <p className="text-base leading-relaxed sm:text-lg">
            {segments.map((seg, i) => {
              if (seg.type === "text") return <span key={i}>{seg.value}</span>

              const filled = placed[seg.index]
              const isCorrect = checked && filled === challenge.blanks[seg.index]
              const isIncorrect = checked && !!filled && !isCorrect
              return (
                <button
                  key={i}
                  onClick={() => handleBlankClick(seg.index)}
                  disabled={checked || (!filled && !selectedTag)}
                  className={cn(
                    "mx-1 inline-flex items-center gap-1 min-w-[4.5rem] rounded-md border px-2 py-0.5 align-baseline text-sm font-medium transition-all",
                    // Avant vérification : un trou rempli reste neutre
                    // (pas de vert/rouge prématuré) — juste rempli ou pas,
                    // et re-cliquable pour changer d'avis.
                    !checked && filled && "cursor-pointer border-ring/40 bg-ring/5 text-foreground hover:border-destructive/40 hover:bg-destructive/5",
                    !checked && !filled && selectedTag && "cursor-pointer border-ring/50 bg-ring/5 text-ring hover:bg-ring/10",
                    !checked && !filled && !selectedTag && "border-dashed border-border text-muted-foreground",
                    isCorrect && "border-success/40 bg-success/10 text-success",
                    isIncorrect && "border-destructive/50 bg-destructive/10 text-destructive",
                  )}
                >
                  {filled ?? "……"}
                  {!checked && filled && <X className="h-3 w-3 opacity-50" />}
                </button>
              )
            })}
          </p>
        </CardContent>
      </Card>

      {!checked && (
        <>
          <div className="flex flex-wrap gap-2">
            {pool.map(tag => (
              <button
                key={tag}
                onClick={() => handleTagClick(tag)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm font-medium transition-all",
                  selectedTag === tag
                    ? "scale-105 border-ring bg-ring/15 text-ring shadow-sm"
                    : "border-border bg-card hover:border-ring/40 hover:bg-muted/40",
                )}
              >
                {tag}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Clique une étiquette puis un trou pour la placer. Un trou déjà rempli se reclique pour changer d&apos;avis.
          </p>
          <Button size="sm" className="gap-2" disabled={!allPlaced} onClick={handleCheck}>
            <CheckCircle2 className="h-4 w-4" /> Vérifier
          </Button>
        </>
      )}

      {checked && (
        <Card className={cn("border shadow-none", finished ? "border-success/30 bg-success/5" : "border-warning/30 bg-warning/5")}>
          <CardContent className="flex flex-col items-center gap-4 p-6 text-center">
            <div className={cn(
              "flex h-14 w-14 items-center justify-center rounded-full",
              finished ? "bg-success/10" : "bg-warning/10",
            )}>
              {finished ? (
                <Trophy className="h-7 w-7 text-success" />
              ) : (
                <CheckCircle2 className="h-7 w-7 text-warning" />
              )}
            </div>
            <div>
              <p className="text-lg font-semibold">
                {finished ? "Texte complété sans erreur !" : `${correctCount} / ${totalBlanks} corrects`}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {finished
                  ? `${totalBlanks} mots bien placés en ${attempts} vérification${attempts > 1 ? "s" : ""}`
                  : "Les mots corrects restent en vert, réessaie les autres."}
              </p>
            </div>
            <div className="flex gap-2">
              {!finished && (
                <Button size="sm" className="gap-2" onClick={handleRetry}>
                  <RefreshCw className="h-4 w-4" /> Réessayer
                </Button>
              )}
              <Button variant="outline" size="sm" className="gap-2" onClick={load}>
                <RefreshCw className="h-4 w-4" /> Nouveau texte
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
