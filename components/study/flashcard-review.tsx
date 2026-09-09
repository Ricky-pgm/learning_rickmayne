"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Badge } from "@/components/ui/badge"
import { Sparkles, RotateCcw, Zap, Dumbbell, ThumbsUp, Star, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"
import { getSupabaseClient } from "@/lib/supabase"
import { getApiErrorMessage } from "@/lib/api-errors"
import { getCachedFlashcards, saveFlashcards, regenerateFlashcards, getFlashcardProgress, saveFlashcardProgress } from "@/lib/study/flashcard-queries"
import { scheduleNext } from "@/lib/study/spaced-repetition"
import type { Flashcard, FlashcardGrade } from "@/lib/study/types"
import type { StudyChapter } from "@/lib/study/types"

interface Props {
  chapter: StudyChapter
  /** Appelé une fois quand la série de cartes du jour est terminée — sert
   * à StudyPhase pour marquer la phase "Mémoriser" comme faite. */
  onSeriesComplete?: () => void
}

const GRADE_CONFIG: { grade: FlashcardGrade; label: string; icon: typeof RotateCcw; tone: string }[] = [
  { grade: "again", label: "À revoir", icon: RotateCcw, tone: "border-destructive/30 text-destructive hover:bg-destructive/10" },
  { grade: "hard", label: "Difficile", icon: Dumbbell, tone: "border-warning/30 text-warning hover:bg-warning/10" },
  { grade: "good", label: "Bien", icon: ThumbsUp, tone: "border-accent-brand/30 text-accent-brand hover:bg-accent-brand/10" },
  { grade: "easy", label: "Facile", icon: Star, tone: "border-success/30 text-success hover:bg-success/10" },
]

export function FlashcardReview({ chapter, onSeriesComplete }: Props) {
  const [userId, setUserId] = useState<string | null>(null)
  const [cards, setCards] = useState<Flashcard[]>([])
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  // Démarre à false : la génération n'est plus automatique au montage —
  // un chapitre simplement survolé déclenchait sinon un appel Haiku
  // payant sans que l'utilisateur ait rien demandé, contrairement à
  // DetailedLessonView et WebEnrichmentView qui attendent une action.
  const [started, setStarted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [streak, setStreak] = useState(0)
  // La carte utilise un flip 3D en position absolute (chaque face occupe
  // exactement la hauteur du conteneur) — avec une hauteur fixe, un verso
  // plus long que le recto se faisait couper au lieu de s'afficher en
  // entier. cardHeight mesure la face la plus haute des deux (recto et
  // verso, même quand seul le verso est visible : la face cachée reste
  // montée sous le flip) et devient la hauteur réelle du conteneur.
  const frontRef = useRef<HTMLDivElement>(null)
  const backRef = useRef<HTMLDivElement>(null)
  const [cardHeight, setCardHeight] = useState(176) // 176px = min-h-44 d'origine, comme plancher

  const loadCards = useCallback(async (forceRegenerate = false) => {
    setLoading(true)
    setError("")
    setStreak(0)
    try {
      let existing = forceRegenerate ? [] : await getCachedFlashcards(chapter.id)
      if (existing.length === 0) {
        const res = await fetch('/api/study/flashcards', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chapterId: chapter.id })
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Erreur')
        // regenerateFlashcards supprime les anciennes cartes avant de
        // réinsérer (sinon un appel forcé les doublerait) — saveFlashcards
        // reste utilisé pour la première génération, où il n'y a rien à
        // supprimer.
        existing = forceRegenerate
          ? await regenerateFlashcards(chapter.id, data.cards)
          : await saveFlashcards(chapter.id, data.cards)
      }
      setCards(existing)
      setIndex(0)
      setFlipped(false)
    } catch (e) {
      setError(getApiErrorMessage(e instanceof Error ? e.message : 'Erreur'))
    } finally {
      setLoading(false)
    }
  }, [chapter])

  function handleRegenerate() {
    if (!confirm("Régénérer la Lernkartei ? Les anciennes cartes et leur progression de révision seront remplacées.")) return
    loadCards(true)
  }

  useEffect(() => {
    getSupabaseClient().auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null)
    })
  }, [])

  useEffect(() => {
    if (!started) return
    Promise.resolve().then(() => loadCards())
  }, [started, loadCards])

  async function handleGrade(grade: FlashcardGrade) {
    const card = cards[index]
    if (!card) return

    if (userId) {
      try {
        const currentState = await getFlashcardProgress(userId, card.id)
        const nextState = scheduleNext(currentState, grade)
        await saveFlashcardProgress(userId, card.id, nextState, grade)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erreur')
      }
    }

    // Update streak
    if (grade === "good" || grade === "easy") {
      setStreak(s => s + 1)
    } else {
      setStreak(0)
    }

    setFlipped(false)
    setIndex(i => {
      const next = i + 1
      if (next >= cards.length) onSeriesComplete?.()
      return next
    })
  }

  // Remesure à chaque nouvelle carte (recto/verso différents) et sur
  // tout changement de largeur (le texte re-wrap, donc la hauteur change)
  // — ResizeObserver plutôt qu'un effet sur [index] seul, pour rester
  // correct aussi en redimensionnant la fenêtre.
  useEffect(() => {
    const front = frontRef.current
    const back = backRef.current
    if (!front || !back) return

    function measure() {
      const height = Math.max(front!.scrollHeight, back!.scrollHeight, 176)
      setCardHeight(height)
    }
    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(front)
    observer.observe(back)
    return () => observer.disconnect()
  }, [index, cards])

  if (!started) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <p className="max-w-sm text-sm text-muted-foreground">
          Des cartes recto-verso générées depuis ce chapitre, avec répétition espacée : les cartes ratées reviennent plus vite.
        </p>
        <Button size="sm" className="gap-2" onClick={() => setStarted(true)}>
          <Sparkles className="h-4 w-4" /> Commencer la Lernkartei
        </Button>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center py-8 gap-3">
        <Spinner className="size-6 text-primary" />
        <p className="text-sm text-muted-foreground">Préparation de la Lernkartei…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => loadCards()}>
          Réessayer
        </Button>
      </div>
    )
  }

  if (cards.length === 0) {
    return (
      <div className="rounded-lg border border-border/70 bg-card p-8 text-center">
        <p className="text-muted-foreground">Aucune carte pour ce chapitre.</p>
      </div>
    )
  }

  if (index >= cards.length) {
    return (
      <Card className="border border-success/30 bg-success/5 shadow-none">
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
            <Sparkles className="h-7 w-7 text-success" />
          </div>
          <p className="text-xl font-semibold">Série terminée !</p>
          <p className="text-sm text-muted-foreground">
            {cards.length} carte{cards.length > 1 ? "s" : ""} révisée{cards.length > 1 ? "s" : ""}
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <Button variant="outline" size="sm" className="gap-2" onClick={() => { setIndex(0); setFlipped(false); setStreak(0) }}>
              <RotateCcw className="h-4 w-4" /> Recommencer
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={handleRegenerate}>
              <RefreshCw className="h-4 w-4" /> Régénérer les cartes
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  const card = cards[index]
  const progress = Math.round((index / cards.length) * 100)

  return (
    <div className="space-y-4">
      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {index + 1} / {cards.length}
          </span>
          <div className="flex items-center gap-2">
            {streak > 1 && (
              <Badge variant="outline" className="text-xs border-warning/40 text-warning gap-1">
                <Zap className="h-3 w-3" /> {streak}
              </Badge>
            )}
            <span className="text-muted-foreground tabular-nums">{progress}%</span>
          </div>
        </div>
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-accent-brand transition-all duration-300 ease-out rounded-full"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Card — vrai retournement 3D (pas de plugin Tailwind pour ça, donc
          les propriétés perspective/backface-visibility/rotateY passent en
          style inline ; tout le reste — couleurs, layout — reste en
          classes). Le recto reste monté sous le verso pendant la rotation
          (backface-visibility: hidden le cache), pas de bascule de contenu
          instantanée comme avant. */}
      <div
        className="cursor-pointer transition-[height] duration-200"
        style={{ perspective: "1200px", height: cardHeight }}
        onClick={() => setFlipped(f => !f)}
      >
        <div
          className="relative h-full transition-transform duration-500 ease-out"
          style={{
            transformStyle: "preserve-3d",
            transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
          }}
        >
          {/* Front */}
          <Card
            ref={frontRef}
            className="absolute inset-0 h-full min-h-44 border border-border/70 bg-card shadow-none hover:border-accent-brand/40"
            style={{ backfaceVisibility: "hidden" }}
          >
            <CardContent className="flex min-h-44 flex-col items-center justify-center gap-4 p-6 text-center">
              <p className="text-xl font-semibold">{card.front_de}</p>
              <p className="text-xs text-muted-foreground">Clique pour révéler</p>
            </CardContent>
          </Card>

          {/* Back */}
          <Card
            ref={backRef}
            className="absolute inset-0 h-full min-h-44 border border-accent-brand/40 bg-accent-brand/5 shadow-none"
            style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
          >
            <CardContent className="flex min-h-44 flex-col items-center justify-center gap-4 p-6 text-center">
              <div className="space-y-3">
                <p className="text-lg">{card.back_de}</p>
                <p className="text-sm text-muted-foreground italic">{card.back_fr}</p>
                <p className="text-xs text-muted-foreground">Clique pour le recto</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Grade buttons — apparition différée (delay-300) pour arriver après
          que la rotation de la carte (duration-500) soit bien engagée,
          plutôt que de sauter à l'écran avant même que le verso soit
          visible. */}
      {flipped && (
        <div className="grid animate-in fade-in slide-in-from-bottom-1 grid-cols-2 gap-2 delay-300 duration-300 sm:grid-cols-4">
          {GRADE_CONFIG.map(({ grade, label, icon: Icon, tone }) => (
            <Button key={grade} variant="outline" className={cn("gap-1.5", tone)} onClick={() => handleGrade(grade)}>
              <Icon className="h-3.5 w-3.5" /> {label}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
