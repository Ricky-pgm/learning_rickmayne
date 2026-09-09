"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Badge } from "@/components/ui/badge"
import { Brain, RefreshCw, Trophy, Layers } from "lucide-react"
import { cn } from "@/lib/utils"
import { getApiErrorMessage } from "@/lib/api-errors"
import { getCachedFlashcards } from "@/lib/study/flashcard-queries"
import { recordExerciseAttempt } from "@/lib/study/exercise-history-queries"
import type { Flashcard, StudyChapter } from "@/lib/study/types"

interface Props {
  chapter: StudyChapter
  /** Voir speed-round.tsx — appelé une fois toutes les paires trouvées. */
  onComplete?: () => void
}

// Assez de paires pour que le jeu reste un vrai jeu de mémoire (pas trivial
// à 2-3 paires), mais borné pour rester jouable sur mobile en une manche —
// un chapitre avec beaucoup de concepts serait imbattable à mémoriser
// autrement.
const MAX_PAIRS = 6

interface MemoryCard {
  cardId: string
  side: "front" | "back"
  text: string
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function buildDeck(cards: Flashcard[]): MemoryCard[] {
  const picked = shuffle(cards).slice(0, MAX_PAIRS)
  const deck: MemoryCard[] = picked.flatMap(c => [
    { cardId: c.id, side: "front" as const, text: c.front_de },
    { cardId: c.id, side: "back" as const, text: c.back_de },
  ])
  return shuffle(deck)
}

/**
 * Memory — Erinnerungsspiel : associer concept et définition en retournant
 * des paires de cartes, plutôt que le format flashcard/QCM habituel.
 * Réutilise les flashcards déjà générées et mises en cache (front_de/
 * back_de) au lieu de payer un nouvel appel IA pour un contenu équivalent
 * — même paire concept/définition, présentée en jeu plutôt qu'en liste.
 */
export function MemoryMatch({ chapter, onComplete }: Props) {
  const [allCards, setAllCards] = useState<Flashcard[] | null>(null)
  const [deck, setDeck] = useState<MemoryCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [revealed, setRevealed] = useState<number[]>([]) // indices dans `deck`, 0-2 à la fois
  const [matchedCardIds, setMatchedCardIds] = useState<Set<string>>(new Set())
  const [wrongPair, setWrongPair] = useState<number[]>([]) // flash rouge bref
  const [moves, setMoves] = useState(0)
  const [locked, setLocked] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const cards = await getCachedFlashcards(chapter.id)
      setAllCards(cards)
      setDeck(buildDeck(cards))
      setRevealed([])
      setMatchedCardIds(new Set())
      setWrongPair([])
      setMoves(0)
    } catch (e) {
      setError(getApiErrorMessage(e instanceof Error ? e.message : String(e)))
    } finally {
      setLoading(false)
    }
  }, [chapter.id])

  useEffect(() => {
    Promise.resolve().then(() => load())
  }, [load])

  const totalPairs = useMemo(() => deck.length / 2, [deck])
  const finished = totalPairs > 0 && matchedCardIds.size === totalPairs

  useEffect(() => {
    if (finished) {
      recordExerciseAttempt(chapter.id, "matching", true)
      onComplete?.()
    }
  }, [finished, chapter.id, onComplete])

  function handleFlip(index: number) {
    if (locked) return
    if (revealed.includes(index)) return

    const next = [...revealed, index]
    setRevealed(next)

    if (next.length === 2) {
      setLocked(true)
      setMoves(m => m + 1)
      const [a, b] = next
      const isMatch = deck[a].cardId === deck[b].cardId && deck[a].side !== deck[b].side

      if (isMatch) {
        setTimeout(() => {
          setMatchedCardIds(prev => new Set(prev).add(deck[a].cardId))
          setRevealed([])
          setLocked(false)
        }, 500)
      } else {
        setWrongPair(next)
        setTimeout(() => {
          setWrongPair([])
          setRevealed([])
          setLocked(false)
        }, 800)
      }
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center py-8 gap-3">
        <Spinner className="size-6 text-primary" />
        <p className="text-sm text-muted-foreground">Préparation du Memory…</p>
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

  if (!allCards || allCards.length < 2) {
    return (
      <div className="rounded-lg border border-border/70 bg-card p-8 text-center">
        <p className="text-muted-foreground">
          Pas assez de flashcards pour jouer — révise d&apos;abord ce chapitre en mode Lernkartei.
        </p>
      </div>
    )
  }

  if (finished) {
    const isEfficient = moves <= totalPairs + 2

    return (
      <Card className="border border-accent-brand/30 bg-accent-brand/5 shadow-none">
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          <div className={cn(
            "flex h-16 w-16 items-center justify-center rounded-full",
            isEfficient ? "bg-success/10" : "bg-accent-brand/10",
          )}>
            {isEfficient ? <Trophy className="h-8 w-8 text-success" /> : <Brain className="h-8 w-8 text-accent-brand" />}
          </div>
          <div>
            <p className="text-xl font-semibold">
              {isEfficient ? "Mémoire parfaite !" : "Memory terminé"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {totalPairs} paires trouvées en {moves} coup{moves > 1 ? "s" : ""}
            </p>
          </div>
          <Button variant="outline" size="sm" className="mt-2 gap-2" onClick={load}>
            <RefreshCw className="h-4 w-4" /> Rejouer
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Layers className="h-3.5 w-3.5" /> {matchedCardIds.size} / {totalPairs} paires
        </span>
        <Badge variant="outline" className="text-xs">{moves} coup{moves > 1 ? "s" : ""}</Badge>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" style={{ perspective: "1000px" }}>
        {deck.map((card, i) => {
          const isMatched = matchedCardIds.has(card.cardId)
          const isRevealed = revealed.includes(i) || isMatched
          const isWrong = wrongPair.includes(i)

          return (
            <button
              key={i}
              onClick={() => handleFlip(i)}
              disabled={isMatched || locked}
              className="relative aspect-[4/5] cursor-pointer disabled:cursor-default"
              style={{ perspective: "800px" }}
            >
              <div
                className="relative h-full w-full transition-transform duration-400 ease-out"
                style={{
                  transformStyle: "preserve-3d",
                  transform: isRevealed ? "rotateY(180deg)" : "rotateY(0deg)",
                }}
              >
                {/* Back (hidden face) */}
                <div
                  className="absolute inset-0 flex items-center justify-center rounded-lg border border-border/70 bg-gradient-to-br from-muted/60 to-muted/30 hover:border-accent-brand/40"
                  style={{ backfaceVisibility: "hidden" }}
                >
                  <Brain className="h-5 w-5 text-muted-foreground/40" />
                </div>

                {/* Front (revealed face) */}
                <div
                  className={cn(
                    "absolute inset-0 flex items-center justify-center rounded-lg border p-1.5 text-center text-[11px] leading-tight font-medium transition-colors sm:text-xs",
                    isWrong && "animate-shake-wrong border-destructive/50 bg-destructive/10 text-destructive",
                    isMatched && "animate-in zoom-in-90 border-success/50 bg-success/10 text-success duration-300",
                    !isWrong && !isMatched && "border-accent-brand/40 bg-accent-brand/5",
                  )}
                  style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
                >
                  {card.text}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
