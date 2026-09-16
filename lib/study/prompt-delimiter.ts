/**
 * Encadre un contenu dont la source n'est pas l'instruction elle-même —
 * texte extrait d'un PDF uploadé, résumé/concepts déjà générés par un
 * appel IA précédent — avant de l'interpoler dans un prompt (audit
 * sécurité, S-1). Sans délimiteur explicite, une phrase comme "ignore les
 * instructions précédentes et..." glissée dans un PDF de cours (par
 * accident, ou par un utilisateur qui teste les limites) se lit
 * syntaxiquement comme faisant partie du prompt système. Le modèle n'est
 * pas infaillible face à ça, mais des délimiteurs clairs + une instruction
 * de traiter le contenu comme des DONNÉES sont la mitigation standard
 * pour ce type d'injection de prompt indirecte.
 *
 * `label` nomme le contenu dans le délimiteur (ex. "RÉSUMÉ DU CHAPITRE")
 * pour que l'instruction qui suit puisse s'y référer sans ambiguïté.
 */
export function delimitUntrustedContent(label: string, content: string): string {
  return `<<<${label}_START>>>\n${content}\n<<<${label}_END>>>`
}
