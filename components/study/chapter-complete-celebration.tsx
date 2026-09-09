"use client"

import { useMemo } from "react"
import { PartyPopper, ArrowRight } from "lucide-react"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface Props {
  open: boolean
  onClose: () => void
  chapterTitle: string
  /** Chapitre suivant du cours, s'il y en a un — sinon juste "Continuer". */
  nextHref: string | null
  nextChapterTitle: string | null
}

const CONFETTI_COLORS = ["bg-ring", "bg-success", "bg-warning", "bg-destructive"]

/**
 * Célébration au moment où les 3 phases d'un chapitre (Comprendre /
 * Mémoriser / S'entraîner) sont toutes complétées — jusqu'ici le seul
 * moment "fun" marqué dans l'app était le streak de jours consécutifs
 * (voir MilestoneCelebration sur le dashboard) ; terminer un chapitre
 * entier ne déclenchait rien de plus qu'un anneau qui passe au vert en
 * silence. Même pattern que MilestoneCelebration (dialog + dégradé) pour
 * rester cohérent, avec une pluie de confettis en CSS pur (pas de lib
 * lourde pour un effet ponctuel) puisque c'est un jalon plus rare et plus
 * significatif qu'un jour de streak.
 */
export function ChapterCompleteCelebration({ open, onClose, chapterTitle, nextHref, nextChapterTitle }: Props) {
  // Générées une seule fois par montage, pas à chaque re-render — sinon
  // l'animation recommencerait de zéro à chaque frappe/état parent.
  const confetti = useMemo(
    () =>
      Array.from({ length: 24 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.4,
        duration: 1.4 + Math.random() * 0.8,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        rotate: Math.random() * 360,
      })),
    [],
  )

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent showCloseButton={false} className="overflow-hidden">
        <div className="relative -m-4 mb-0 flex flex-col items-center gap-3 overflow-hidden bg-gradient-to-br from-success/15 via-ring/10 to-success/5 px-4 pt-8 pb-6 text-center">
          {/* Confettis : chute + rotation en CSS, rejoués une seule fois
              (l'animation ne boucle pas) — motion-safe uniquement, un
              viewer avec "réduire les animations" ne les voit pas tomber. */}
          <div className="pointer-events-none absolute inset-0 motion-safe:block motion-reduce:hidden" aria-hidden="true">
            {confetti.map((c, i) => (
              <span
                key={i}
                className={cn("absolute top-0 h-2 w-2 rounded-sm opacity-90", c.color)}
                style={{
                  left: `${c.left}%`,
                  animation: `chapter-confetti-fall ${c.duration}s ease-in ${c.delay}s forwards`,
                  transform: `rotate(${c.rotate}deg)`,
                }}
              />
            ))}
          </div>
          <style>{`
            @keyframes chapter-confetti-fall {
              from { transform: translateY(-10px) rotate(0deg); opacity: 0.9; }
              to { transform: translateY(160px) rotate(360deg); opacity: 0; }
            }
          `}</style>

          <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-success to-ring text-white shadow-lg">
            <PartyPopper className="h-8 w-8" />
          </div>
          <DialogTitle className="relative text-xl font-bold">Chapitre terminé !</DialogTitle>
        </div>
        <div className="space-y-4 px-1 pb-1 text-center">
          <DialogDescription className="text-sm">
            <span className="font-medium text-foreground">{chapterTitle}</span> — cours lu, cartes révisées, exercice pratiqué. Les trois étapes sont faites.
          </DialogDescription>
          {nextHref && nextChapterTitle ? (
            <a href={nextHref} className="block">
              {/* Button force whitespace-nowrap (par design, pour son
                  usage habituel avec un texte court) — un titre de
                  chapitre long se faisait donc couper au lieu de passer
                  à la ligne. Le texte dynamique passe dans un span à part
                  qui autorise le wrap ; le bouton lui-même s'étire en
                  hauteur pour l'accueillir plutôt que le tronquer. */}
              <Button className="h-auto w-full gap-2 whitespace-normal py-2.5 text-center" onClick={onClose}>
                <span className="flex-1">Chapitre suivant : {nextChapterTitle}</span>
                <ArrowRight className="h-4 w-4 flex-shrink-0" />
              </Button>
            </a>
          ) : (
            <Button onClick={onClose} className="w-full gap-2">
              Continuer
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
