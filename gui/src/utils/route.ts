/**
 * Adresse d'une vue de l'interface, portée par le fragment de l'URL :
 * `#/page/<id>` pour une page, `#/page/<id>/retours` pour la page des retours,
 * `#/page/<id>/retours/<n>` pour un retour précis.
 *
 * Le fragment ne quitte jamais le navigateur : il reste valable derrière le
 * préfixe variable du proxy comme dans le fichier HTML autonome.
 */
export interface Route {
  designId: string | null
  rounds: boolean
  round: number | null
}

export function parseRoute(hash: string): Route {
  const segments = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  const route: Route = { designId: null, rounds: false, round: null }
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]
    if (segment === 'page' && segments[index + 1] !== undefined) {
      route.designId = decodeURIComponent(segments[++index])
    } else if (segment === 'retours') {
      route.rounds = true
      const next = segments[index + 1]
      if (next !== undefined && /^\d+$/.test(next)) {
        route.round = Number(next)
        index++
      }
    }
  }
  return route
}

export function formatRoute(route: Route): string {
  const segments: string[] = []
  if (route.designId !== null) segments.push('page', encodeURIComponent(route.designId))
  if (route.rounds) {
    segments.push('retours')
    if (route.round !== null) segments.push(String(route.round))
  }
  return segments.length === 0 ? '' : `#/${segments.join('/')}`
}
