"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Badge } from "@/components/ui/badge"
import { Network, RefreshCw, Trophy, CheckCircle2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { getApiErrorMessage } from "@/lib/api-errors"
import { recordExerciseAttempt } from "@/lib/study/exercise-history-queries"
import type { StudyChapter } from "@/lib/study/types"
import type { ConceptMapChallenge, ConceptMapEdge } from "@/lib/study/concept-map-prompt"

interface Props {
  chapter: StudyChapter
  /** Voir speed-round.tsx — appelé une fois toutes les relations trouvées. */
  onComplete?: () => void
}

interface Point {
  x: number
  y: number
}

interface FoundEdge extends ConceptMapEdge {
  fromPoint: Point
  toPoint: Point
}

// Coordonnées en pourcentage (0-100) sur un cercle — layout stable quel
// que soit le nombre de nœuds (4 à 8, voir concept-map-prompt.ts), pas
// besoin d'une lib de graphes pour un si petit nombre de bulles.
function layoutNodes(nodes: string[]): Record<string, Point> {
  const cx = 50, cy = 50, r = 38
  const positions: Record<string, Point> = {}
  nodes.forEach((node, i) => {
    const angle = (i / nodes.length) * 2 * Math.PI - Math.PI / 2
    positions[node] = {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    }
  })
  return positions
}

function edgeKey(from: string, to: string) {
  return [from, to].sort().join("|")
}

/**
 * Point d'ancrage du label d'une relation — décalé perpendiculairement au
 * segment plutôt que posé pile sur son milieu. Sur un layout circulaire à
 * 4-8 nœuds, plusieurs relations partent souvent d'un même sommet
 * (ex. "Hardware" relié à 3 autres concepts) : leurs milieux de segment
 * tombent tous près de ce sommet et les libellés textuels se chevauchent
 * illisiblement. `spread` (0, 1, 2...) écarte les libellés d'un même
 * groupe de relations qui se chevaucheraient sinon.
 */
function labelPoint(from: Point, to: Point, spread: number): Point {
  const mx = (from.x + to.x) / 2
  const my = (from.y + to.y) / 2
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  // Perpendiculaire unitaire au segment.
  const px = -dy / len
  const py = dx / len
  const offset = 4 + spread * 5
  return { x: mx + px * offset, y: my + py * offset }
}

/**
 * Carte des concepts — relier deux concepts par un trait pour retrouver
 * les relations attendues entre eux (pas concept -> définition, déjà
 * couvert par MemoryMatch). Sans chrono, comme BugHunt : la réflexion sur
 * une relation structurelle ne se prête pas à la pression du temps. Score
 * basé sur le nombre d'essais ratés.
 */
export function ConceptMap({ chapter, onComplete }: Props) {
  const [challenge, setChallenge] = useState<ConceptMapChallenge | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [selected, setSelected] = useState<string | null>(null)
  const [foundEdges, setFoundEdges] = useState<FoundEdge[]>([])
  const [wrongFlash, setWrongFlash] = useState<[string, string] | null>(null)
  const [attempts, setAttempts] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    setSelected(null)
    setFoundEdges([])
    setWrongFlash(null)
    setAttempts(0)
    try {
      const res = await fetch("/api/study/concept-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapterId: chapter.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Erreur")
      setChallenge(data as ConceptMapChallenge)
    } catch (e) {
      setError(getApiErrorMessage(e instanceof Error ? e.message : "Erreur"))
    } finally {
      setLoading(false)
    }
  }, [chapter.id])

  useEffect(() => {
    Promise.resolve().then(() => load())
  }, [load])

  const positions = useMemo(() => (challenge ? layoutNodes(challenge.nodes) : {}), [challenge])
  const totalEdges = challenge?.edges.length ?? 0
  const finished = totalEdges > 0 && foundEdges.length === totalEdges

  useEffect(() => {
    if (finished) {
      recordExerciseAttempt(chapter.id, "conceptMap", attempts === totalEdges)
      onComplete?.()
    }
  }, [finished, attempts, totalEdges, chapter.id, onComplete])

  // Efface le flash rouge après un court délai, sans bloquer d'autres clics.
  useEffect(() => {
    if (!wrongFlash) return
    const timer = setTimeout(() => setWrongFlash(null), 600)
    return () => clearTimeout(timer)
  }, [wrongFlash])

  function handleNodeClick(node: string) {
    if (!challenge || finished) return

    if (selected === null) {
      setSelected(node)
      return
    }

    if (selected === node) {
      setSelected(null)
      return
    }

    const already = foundEdges.some(e => edgeKey(e.from, e.to) === edgeKey(selected, node))
    if (already) {
      setSelected(null)
      return
    }

    const match = challenge.edges.find(e => edgeKey(e.from, e.to) === edgeKey(selected, node))
    setAttempts(a => a + 1)

    if (match) {
      setFoundEdges(prev => [
        ...prev,
        { ...match, fromPoint: positions[match.from], toPoint: positions[match.to] },
      ])
    } else {
      setWrongFlash([selected, node])
    }
    setSelected(null)
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center py-8 gap-3">
        <Spinner className="size-6 text-primary" />
        <p className="text-sm text-muted-foreground">Préparation de la carte…</p>
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

  if (!challenge || challenge.nodes.length < 2) {
    return (
      <div className="rounded-lg border border-border/70 bg-card p-8 text-center">
        <p className="text-muted-foreground">Aucune carte générée.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Network className="h-3.5 w-3.5" /> {foundEdges.length} / {totalEdges} relations
        </span>
        {attempts > foundEdges.length && (
          <Badge variant="outline" className="text-xs">{attempts} essais</Badge>
        )}
      </div>

      <Card className="border border-border/70 bg-card shadow-none">
        <CardContent className="p-3 sm:p-5">
          <div className="relative aspect-square w-full max-w-md mx-auto">
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100">
              {foundEdges.map((e, i) => {
                const label = labelPoint(e.fromPoint, e.toPoint, i)
                // Largeur approximative du fond, calée sur la longueur du
                // texte — un fond trop étroit laisserait les extrémités du
                // libellé se mélanger aux traits qui passent derrière.
                const labelWidth = Math.min(38, 3 + e.relation_fr.length * 1.7)
                return (
                  <g key={i}>
                    <line
                      x1={e.fromPoint.x} y1={e.fromPoint.y}
                      x2={e.toPoint.x} y2={e.toPoint.y}
                      className="stroke-success"
                      strokeWidth="0.6"
                    />
                    {/* Fond derrière le texte : sans lui, un trait ou un
                        autre libellé qui passe juste derrière rendait le
                        texte illisible dès que deux relations se croisaient. */}
                    <rect
                      x={label.x - labelWidth / 2}
                      y={label.y - 2.2}
                      width={labelWidth}
                      height="4.4"
                      rx="1.2"
                      className="fill-card"
                      opacity="0.92"
                    />
                    <text
                      x={label.x}
                      y={label.y}
                      dominantBaseline="middle"
                      textAnchor="middle"
                      className="fill-success"
                      style={{ fontSize: "2.6px", fontWeight: 600 }}
                    >
                      {e.relation_fr}
                    </text>
                  </g>
                )
              })}
              {wrongFlash && (
                <line
                  x1={positions[wrongFlash[0]]?.x} y1={positions[wrongFlash[0]]?.y}
                  x2={positions[wrongFlash[1]]?.x} y2={positions[wrongFlash[1]]?.y}
                  className="stroke-destructive"
                  strokeWidth="0.6"
                  strokeDasharray="2,1.5"
                />
              )}
              {selected && (
                <line
                  x1={positions[selected]?.x} y1={positions[selected]?.y}
                  x2={positions[selected]?.x} y2={positions[selected]?.y}
                  className="stroke-ring"
                />
              )}
            </svg>

            {challenge.nodes.map(node => {
              const pos = positions[node]
              const isSelected = selected === node
              const isConnected = foundEdges.some(e => e.from === node || e.to === node)
              return (
                <button
                  key={node}
                  onClick={() => handleNodeClick(node)}
                  disabled={finished}
                  style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                  className={cn(
                    "absolute max-w-[7.5rem] -translate-x-1/2 -translate-y-1/2 rounded-full border px-2.5 py-1.5 text-center text-[11px] font-medium leading-tight transition-all sm:text-xs",
                    isSelected && "scale-105 border-ring bg-ring/15 text-ring shadow-sm",
                    !isSelected && isConnected && "border-success/40 bg-success/10 text-success",
                    !isSelected && !isConnected && "border-border bg-card hover:border-ring/40 hover:bg-muted/40",
                  )}
                >
                  {node}
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {selected && (
        <p className="text-center text-xs text-muted-foreground">
          Choisis un second concept à relier à « {selected} »
        </p>
      )}

      {finished && (
        <Card className="border border-success/30 bg-success/5 shadow-none">
          <CardContent className="flex flex-col items-center gap-4 p-6 text-center">
            <div className={cn(
              "flex h-14 w-14 items-center justify-center rounded-full",
              attempts === totalEdges ? "bg-success/10" : "bg-ring/10",
            )}>
              {attempts === totalEdges ? (
                <Trophy className="h-7 w-7 text-success" />
              ) : (
                <CheckCircle2 className="h-7 w-7 text-ring" />
              )}
            </div>
            <div>
              <p className="text-lg font-semibold">
                {attempts === totalEdges ? "Carte complétée sans erreur !" : "Carte complétée !"}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {totalEdges} relations trouvées en {attempts} essai{attempts > 1 ? "s" : ""}
              </p>
            </div>
            <Button variant="outline" size="sm" className="gap-2" onClick={load}>
              <RefreshCw className="h-4 w-4" /> Nouvelle carte
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
