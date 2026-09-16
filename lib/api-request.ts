/**
 * `await req.json()` seul lève une exception non gérée si le corps de la
 * requête est vide, malformé, ou pas du JSON — les 13 routes API de ce
 * projet (app/api/study/*, app/api/{klausur,exercise,lesson}) faisaient
 * ça hors de tout try/catch (audit sécurité, F-4). Résultat concret : un
 * corps invalide remonte en 500 générique avec la stack trace du parseur
 * JSON dans les logs, plutôt qu'un 400 clair — impact réel faible (ces
 * routes sont authentifiées, un client normal envoie toujours du JSON
 * valide), mais 13 occurrences du même oubli valent la peine d'un helper
 * partagé plutôt que 13 try/catch identiques copiés-collés.
 *
 * Retourne `null` (jamais une exception) sur un corps invalide — chaque
 * route décide elle-même du message d'erreur exact, cohérent avec ce
 * qu'elle validait déjà après coup (ex. "chapterId manquant").
 */
export async function parseJsonBody<T = unknown>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T
  } catch {
    return null
  }
}
