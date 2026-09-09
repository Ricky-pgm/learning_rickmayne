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

/**
 * Coordonnées en pourcentage (0-100) — pas besoin d'une lib de graphes
 * pour 4-8 nœuds. Un simple cercle uniforme (ordre arbitraire de
 * challenge.nodes) créait un vrai défaut visuel dès qu'un nœud avait
 * plusieurs relations ("hub") : deux voisins de ce hub pouvaient finir
 * alignés avec un troisième nœud non lié entre eux, et le trait qui les
 * relie traversait alors visuellement ce nœud tiers (repéré sur un
 * screenshot réel : "Innovation" barré par le trait Unternehmenserfolg
 * → Sicherheit).
 *
 * Quand un hub existe (un nœud relié à au moins 3 autres), on bascule en
 * layout étoile : le hub au centre exact du cercle, tous ses voisins
 * répartis uniformément autour de lui. Un rayon qui part du centre ne
 * peut alors plus, par construction géométrique, passer par-dessus un
 * autre nœud du même cercle. Sans hub clair (arêtes dispersées entre
 * plusieurs paires sans nœud dominant), on garde le cercle uniforme —
 * le problème ne se pose pas dans ce cas.
 */
function layoutNodes(nodes: string[], edges: ConceptMapEdge[]): Record<string, Point> {
  const cx = 50, cy = 50, r = 38
  const positions: Record<string, Point> = {}

  const degree = new Map<string, number>()
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1)
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1)
  }
  let hub: string | null = null
  let hubDegree = 0
  for (const [node, d] of degree) {
    if (d > hubDegree) { hub = node; hubDegree = d }
  }

  if (hub && hubDegree >= 3) {
    positions[hub] = { x: cx, y: cy }
    const others = nodes.filter(n => n !== hub)
    others.forEach((node, i) => {
      const angle = (i / others.length) * 2 * Math.PI - Math.PI / 2
      positions[node] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) }
    })
    return positions
  }

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
 * Pour chaque arête trouvée, détermine son "hub" (le nœud partagé avec le
 * plus d'autres arêtes trouvées parmi from/to) et son rang parmi les
 * arêtes de ce hub — alimente labelPoint pour répartir les labels le long
 * de chaque segment plutôt que de les empiler tous au même endroit.
 */
function computeEdgeRanks(edges: FoundEdge[]): { rank: number; rankTotal: number }[] {
  const degree = new Map<string, number>()
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1)
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1)
  }

  const hubOf = edges.map(e => {
    const fromDeg = degree.get(e.from) ?? 0
    const toDeg = degree.get(e.to) ?? 0
    return fromDeg >= toDeg ? e.from : e.to
  })

  const seenPerHub = new Map<string, number>()
  const totalPerHub = new Map<string, number>()
  for (const hub of hubOf) totalPerHub.set(hub, (totalPerHub.get(hub) ?? 0) + 1)

  return hubOf.map(hub => {
    const rank = seenPerHub.get(hub) ?? 0
    seenPerHub.set(hub, rank + 1)
    return { rank, rankTotal: totalPerHub.get(hub) ?? 1 }
  })
}

/**
 * Point d'ancrage du label d'une relation. Un layout circulaire à 4-8
 * nœuds a souvent un "hub" relié à 3-5 autres concepts (ex.
 * "Unternehmenserfolg" au centre relié à Effizienz/Sicherheit/
 * Innovation/Skalierung) : si chaque label se pose au même point fixe du
 * segment (le milieu), tous les libellés partant de ce hub s'écrasent au
 * même endroit, illisibles. Deux leviers combinés pour les séparer :
 * - `t` : position le long du segment (0 = début, 1 = fin) — variée selon
 *   le rang de cette arête parmi les autres arêtes du MÊME nœud hub,
 *   plutôt que fixée à 0.5 pour toutes. Rapprocher chaque label de "from"
 *   dans une position différente les étale visuellement le long de
 *   chaque trait au lieu de les empiler au centre commun.
 * - un léger décalage perpendiculaire, réduit par rapport à avant (la
 *   variation de `t` fait déjà la majeure partie du travail de séparation).
 *
 * @param rank position de cette arête parmi les arêtes du hub (0, 1, 2...)
 * @param rankTotal nombre total d'arêtes partageant ce hub
 */
function labelPoint(from: Point, to: Point, rank: number, rankTotal: number): Point {
  // Étale t entre 0.3 et 0.7 selon le rang — jamais pile au centre (0.5)
  // pour une seule arête isolée non plus, pour rester cohérent avec le
  // texte qui doit rester lisible au-dessus de la bulle "from".
  const t = rankTotal <= 1 ? 0.5 : 0.3 + (rank / (rankTotal - 1)) * 0.4
  const mx = from.x + (to.x - from.x) * t
  const my = from.y + (to.y - from.y) * t
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const px = -dy / len
  const py = dx / len
  // Alterne le côté du trait selon la parité du rang — sans ça, des
  // labels voisins sur des `t` proches mais du même côté peuvent encore
  // se toucher.
  const side = rank % 2 === 0 ? 1 : -1
  const offset = 3.5 * side
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

  const positions = useMemo(() => (challenge ? layoutNodes(challenge.nodes, challenge.edges) : {}), [challenge])
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

  // Recalculé à chaque rendu — coût négligeable (4-8 nœuds, au plus une
  // poignée d'arêtes) — plutôt qu'un useMemo qui ajouterait une
  // dépendance à surveiller pour un calcul aussi léger.
  const edgeRanks = computeEdgeRanks(foundEdges)
  // Le rayon du cercle (layoutNodes) est fixe en unités SVG — avec 7-8
  // nœuds au lieu de 4-5, l'espace angulaire entre bulles voisines
  // diminue mécaniquement, donc des bulles de largeur fixe se
  // chevauchaient (texte de deux concepts distincts fusionné
  // visuellement). La largeur max des bulles diminue avec le nombre de
  // nœuds plutôt que de rester fixe.
  const nodeMaxWidthPx = challenge.nodes.length <= 5 ? 120 : challenge.nodes.length <= 6 ? 100 : 84

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
                const { rank, rankTotal } = edgeRanks[i]
                const label = labelPoint(e.fromPoint, e.toPoint, rank, rankTotal)
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
                  style={{ left: `${pos.x}%`, top: `${pos.y}%`, maxWidth: nodeMaxWidthPx }}
                  className={cn(
                    "absolute -translate-x-1/2 -translate-y-1/2 rounded-full border px-2.5 py-1.5 text-center text-[11px] font-medium leading-tight transition-all sm:text-xs",
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
