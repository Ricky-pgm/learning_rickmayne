# Audit technique — Identité visuelle de it-learn

Date : 2026-09-09
Périmètre : système de design actuel (couleurs, typographie, formes, animation, composants), basé sur une lecture directe du code — aucune supposition, chaque point renvoie au fichier et à la ligne exacte.

---

## 1. Fondation : système Vercel Geist, repris tel quel

Le fichier [`app/globals.css`](../app/globals.css) documente lui-même sa source en commentaire, dès les premières lignes :

```css
/* ─── Vercel Geist Color System ─────────────────────────────────────────────
   Light: https://vercel.com/design.md
   Dark:  https://vercel.com/design.dark.md
   ────────────────────────────────────────────────────────────────────────── */
```

Ce n'est pas une palette maison inspirée de Vercel : c'est littéralement le design system Vercel (Geist) recopié — tokens de couleur, échelle de gris, courbes de rayon, tout.

**Conséquence directe** : l'app a aujourd'hui l'identité visuelle d'un produit *dev-tool* (dashboard Vercel, docs Next.js), pas celle d'un outil de révision pensé pour des étudiants qui doit "faire fun". Le résultat est propre et cohérent, mais générique : n'importe quel SaaS récent construit sur shadcn/Vercel aurait exactement cette palette.

---

## 2. Couleurs — tokens réels

Source : [`app/globals.css` lignes 11–161](../app/globals.css#L11-L161).

### Light

| Token | Valeur | Rôle |
|---|---|---|
| `--background` | `#ffffff` | fond de page |
| `--foreground` | `#171717` | texte principal |
| `--card` | `#ffffff` | fond des cartes |
| `--primary` | `#171717` (noir) | CTA principal, boutons par défaut |
| `--secondary` / `--muted` | `#f2f2f2` | fonds neutres, zones secondaires |
| `--muted-foreground` | `#8f8f8f` | texte atténué |
| `--accent` | `#ebebeb` | légèrement plus sombre que muted |
| `--border` / `--input` | `#eaeaea` | traits, séparateurs |
| `--ring` | `#006bff` (bleu Vercel) | **focus ring — seule vraie couleur vive du système** |
| `--success` | `#28a948` (vert) | statut positif |
| `--warning` | `#ffae00` (ambre) | statut attention |
| `--destructive` | `#fc0035` (rouge) | erreur |
| `--chart-1..5` | `#c9c9c9` → `#171717` | échelle de gris pure, pas de couleur |

### Dark

| Token | Valeur | Rôle |
|---|---|---|
| `--background` | `#000000` (noir pur) | fond de page |
| `--foreground` | `#ededed` | texte principal |
| `--card` | `#111111` | légère élévation sur le noir |
| `--primary` | `#ededed` (blanc cassé) | inversé par rapport au light |
| `--ring` | `#0090ff` | bleu focus, légèrement éclairci |
| `--success` | `#00ac3a` | |
| `--warning` | `#ffae00` | identique au light |
| `--destructive` | `#f32e40` | |

### Point clé

`--primary` est du **noir/blanc pur**, pas une couleur de marque. La seule couleur qui porte une identité perceptible dans tout le système est `--ring` (bleu `#006bff` / `#0090ff`), utilisée nominalement pour les anneaux de focus mais réemployée de fait comme accent dans plusieurs composants du module étude (`ring-ring/20`, `stroke-ring` sur l'anneau de temps, `bg-ring/[0.03]` sur les panneaux du dashboard).

Il n'existe **aucune couleur secondaire de marque** — pas de violet, rose, orange dédié à l'identité de l'app — en dehors :
- des `chart-*`, qui sont une simple échelle de gris pour les graphiques, pas des couleurs identitaires ;
- des tokens sémantiques (succès/warning/erreur), qui sont fonctionnels (état), pas des choix esthétiques.

Il existe par ailleurs un système de **couleur par profil de cours** (`dotColor`, visible dans les sélecteurs de profil du dashboard `/etude`) — codé en dur ailleurs dans le code (probablement dans les constantes de profils, pas dans `globals.css`), qui donne à chaque profil une pastille de couleur distincte pour la reconnaissance visuelle rapide. C'est le seul endroit où l'app sort du gris/bleu Vercel.

### Piste de réflexion

Le système est *neutre par construction* — pensé pour ne jamais distraire d'une interface outil/dashboard. Deux leviers possibles pour "vivant/fun" :
1. Sortir `--ring` de son rôle purement technique (focus) et l'assumer comme véritable couleur de marque de l'app.
2. Introduire 1 à 2 couleurs d'accent dédiées, distinctes du bleu focus — par exemple une couleur "célébration/gamification" séparée, pour ne pas mélanger accessibilité (focus) et identité (marque).

---

## 3. Typographie

Source : [`app/layout.tsx` lignes 7–9](../app/layout.tsx#L7-L9).

```ts
const fontSans    = Geist({ subsets: ["latin"], variable: "--font-sans" })
const fontHeading = Geist({ subsets: ["latin"], variable: "--font-heading" })
const fontMono    = Geist_Mono({ subsets: ["latin"], variable: "--font-mono", weight: ["400"] })
```

**Constat direct** : `--font-heading` et `--font-sans` chargent **la même police Geist**, juste déclarée deux fois sous deux noms de variable différents. Il n'y a donc **aucune vraie paire typographique** dans l'app — une seule famille (Geist Sans) est utilisée pour tout, y compris les titres. On le voit confirmé dans [`components/ui/card.tsx` ligne 38](../components/ui/card.tsx#L38) : `CardTitle` applique `font-heading`, qui pointe vers la même police que le corps de texte.

`Geist_Mono` est réservée au code (une seule graisse chargée : `400`).

### Piste de réflexion

C'est de nouveau la signature Vercel pure (Geist est leur police maison) : très lisible, très "produit dev" moderne, mais sans personnalité propre — indiscernable de n'importe quelle app Next.js/shadcn récente. Une vraie police d'affichage différenciée pour les titres (plus ronde, plus expressive, plus chaleureuse) créerait un contraste volontaire avec le sans-serif utilitaire du corps, sans toucher à la lisibilité du texte courant. C'est un des changements à plus fort impact perçu pour un coût d'implémentation faible (un seul fichier à modifier).

---

## 4. Formes et rayons

Source : [`app/globals.css` lignes 168–175](../app/globals.css#L168-L175).

```css
--radius: 0.375rem; /* 6px, base */
--radius-sm:  var(--radius);                 /* 6px  = Vercel sm */
--radius-md:  calc(var(--radius) * 2);       /* 12px = Vercel md */
--radius-lg:  calc(var(--radius) * 2.667);   /* 16px = Vercel lg */
--radius-xl:  calc(var(--radius) * 4);       /* 24px */
--radius-2xl: calc(var(--radius) * 5.333);   /* 32px */
--radius-3xl: calc(var(--radius) * 8);       /* 48px */
--radius-4xl: 9999px;                        /* pilule complète */
```

Échelle strictement proportionnelle, calquée sur les paliers `sm/md/lg` de Vercel. En usage réel :
- Cartes → `rounded-xl` (16px)
- Boutons → `rounded-lg`
- Badges → `rounded-4xl` (pilule complète)

Rayon modéré, cohérent par construction (tout dérive d'une seule variable `--radius`), mais visuellement neutre — pas de rayon exagéré, pas de formes organiques ou ludiques. Encore une esthétique "dashboard SaaS" plutôt que "outil d'apprentissage vivant".

---

## 5. Composants de base — logique de poids visuel

### Card — [`components/ui/card.tsx`](../components/ui/card.tsx)

```css
ring-1 ring-foreground/10 rounded-xl bg-card
```

Pas de `border` classique : un `ring` translucide à 10% d'opacité fait office de contour. Le padding est piloté par une variable CSS locale `--card-spacing` (réutilisée par `CardHeader`, `CardContent`, `CardFooter`) — la cohérence d'espacement est garantie par construction, pas par convention copiée-collée entre composants.

### Button — [`components/ui/button.tsx`](../components/ui/button.tsx)

```css
whitespace-nowrap ... active:not-aria-[haspopup]:translate-y-px
```

Deux points notables :
- `whitespace-nowrap` est **forcé en dur** dans la définition `cva` du bouton — piège déjà rencontré concrètement sur la carte de célébration de fin de chapitre (texte de bouton dynamique coupé), qui a nécessité un contournement local (`whitespace-normal` explicite + restructuration du contenu en `<span>` séparé).
- `active:translate-y-px` : un micro-mouvement de pression (1px vers le bas) au clic — c'est la **seule micro-interaction "vivante" présente par défaut** dans tout le système de boutons.
- Variante `default` = bouton plein noir/blanc (primary). Aucune variante de bouton n'utilise `--ring` comme fond : pas de bouton "accent coloré" disponible nativement.

### Badge — [`components/ui/badge.tsx`](../components/ui/badge.tsx)

Forme pilule (`rounded-4xl`), 6 variantes sémantiques : `default / secondary / destructive / outline / ghost / link`. Aucune variante n'utilise `--ring` : il n'existe donc pas de badge "accent" prêt à l'emploi, seulement des badges noir / gris / rouge.

---

## 6. Animation — ce qui existe réellement aujourd'hui

Le **seul système d'animation global** déclaré dans le projet est dans [`app/globals.css` lignes 253–266](../app/globals.css#L253-L266) :

```css
@keyframes shake-wrong {
  10%, 90% { transform: translateX(-1px); }
  20%, 80% { transform: translateX(2px); }
  30%, 50%, 70% { transform: translateX(-4px); }
  40%, 60% { transform: translateX(4px); }
}
.animate-shake-wrong {
  animation: shake-wrong 0.4s ease-in-out;
}
@media (prefers-reduced-motion: reduce) {
  .animate-shake-wrong {
    animation: none;
  }
}
```

Un tremblement de 0.4s déclenché sur mauvaise réponse (Bug Hunt, Code Complete, Memory Match), avec garde d'accessibilité `prefers-reduced-motion` correctement appliquée.

Tout le reste du "vivant" ajouté au fil des sessions précédentes — confettis CSS purs sur la célébration de fin de chapitre, flip 3D des flashcards, entrées échelonnées (`animate-in fade-in slide-in-from-bottom-1`), zoom-in sur bonne réponse, anneau de progression SVG animé — vient de la librairie `tw-animate-css` (importée [`app/globals.css` ligne 2](../app/globals.css#L2)), utilisée au cas par cas, directement dans le JSX de chaque composant.

**Implication concrète** : il n'existe qu'**une seule keyframe personnalisée nommée** à l'échelle du projet (`shake-wrong`). Tout le reste des micro-interactions "vivantes" est composé à la volée via les utilitaires génériques de `tw-animate-css`, composant par composant — fonctionnel et déjà efficace en pratique, mais ce n'est pas un vocabulaire d'animation centralisé : pas de courbe d'easing nommée standard, pas de durée standard réutilisée par convention (chaque composant a potentiellement sa propre durée copiée à la main).

### Piste de réflexion

Centraliser 3–4 keyframes nommées (ex. `celebrate-pop`, `card-flip`, `progress-fill`, `streak-pulse`) avec des durées/easings documentés dans `globals.css`, à la manière de `shake-wrong`, plutôt que de laisser chaque nouveau composant réinventer sa propre animation via des utilitaires génériques.

---

## 7. Tableau récapitulatif

| Dimension | État actuel | Verdict pour "vivant / fun" |
|---|---|---|
| **Couleur** | Système Vercel neutre : noir/blanc/gris + 1 bleu de focus + tokens sémantiques (succès/warning/erreur) | Sobre et professionnel, mais aucune couleur n'appartient réellement à la marque it-learn |
| **Typographie** | Une seule famille (Geist) déclarée sous deux noms de variable (`--font-sans` et `--font-heading` sont identiques) | Pas de vraie hiérarchie de personnalité entre titres et corps de texte |
| **Formes** | Rayons modérés (6/12/16px...), échelle strictement proportionnelle dérivée de Vercel | Cohérent techniquement, neutre visuellement |
| **Densité / esprit général** | Dashboard SaaS / outil développeur | En tension directe avec l'objectif affiché de l'app : apprendre n'importe où, avec du fun |
| **Animation** | 1 seule keyframe nommée globale (`shake-wrong`) + micro-interactions ad hoc par composant via `tw-animate-css` | Efficace ponctuellement, mais pas un système nommé et documenté |
| **Composants de base** | Construits sur base-ui + `cva`, façon shadcn : propres, accessibles, dark mode complet | Solides techniquement, zéro personnalité visuelle propre à l'app |

---

## 8. Conclusion

Techniquement, tout est propre et cohérent : variables CSS bien structurées, tokens dark/light complets et correctement séparés, `cva` pour les variantes de composants, garde `prefers-reduced-motion` respectée. Mais l'identité visuelle actuelle est, très concrètement, celle d'un **clone quasi littéral du design system Vercel (Geist)** — pas une identité pensée spécifiquement pour it-learn, ni pour son public réel : des étudiants qui révisent, en Allemagne, avec un objectif explicite de plaisir d'apprendre.

C'est probablement le terrain de réflexion le plus fertile pour la prochaine étape : conserver la rigueur technique du système actuel (tokens, dark mode complet, `cva`, accessibilité) mais lui injecter une palette et une typographie qui appartiennent réellement à it-learn plutôt qu'à Vercel — sans tout reconstruire, puisque l'architecture en tokens permet déjà de changer les valeurs à la racine sans toucher aux composants.
