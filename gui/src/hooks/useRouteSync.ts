import { useEffect } from 'react'
import { readLastDesignId, useDesignStore } from '../store/useDesignStore'
import { useRemarkStore } from '../store/useRemarkStore'
import { buildGroupTree, firstDesignOf } from '../utils/design-groups'
import { formatRoute, parseRoute, type Route } from '../utils/route'

let replaceNext = false
/** Vrai pendant qu'une adresse saisie ou revisitée est appliquée à l'interface. */
let applying = false
/** Vrai une fois la première page ouverte : l'adresse de départ a été lue. */
let started = false

/** La prochaine vue remplace l'entrée courante de l'historique au lieu de s'y ajouter. */
export function replaceNextRoute() {
  replaceNext = true
}

function currentRoute(): Route {
  const { design } = useDesignStore.getState()
  const { roundsOpen, selectedRound } = useRemarkStore.getState()
  return { designId: design?.id ?? null, rounds: roundsOpen, round: roundsOpen ? selectedRound : null }
}

/**
 * Inscrit la vue courante dans l'URL. Une adresse qui ne désigne aucune page
 * existante (première ouverture, page supprimée, lien périmé) est remplacée ;
 * toute autre navigation ajoute une entrée à l'historique.
 */
function writeRoute(forceReplace = false) {
  const { design, designs } = useDesignStore.getState()
  if (applying || design === null) return

  const hash = formatRoute(currentRoute())
  if (hash === window.location.hash) return

  const shown = parseRoute(window.location.hash).designId
  const replace =
    forceReplace || replaceNext || shown === null || !designs.some((entry) => entry.id === shown)
  replaceNext = false

  // URL absolue : la balise <base> injectée par le proxy ne doit pas réécrire le chemin.
  const url = window.location.href.split('#')[0] + hash
  if (replace) window.history.replaceState(window.history.state, '', url)
  else window.history.pushState(null, '', url)
}

function applyRounds(route: Route) {
  const remarks = useRemarkStore.getState()
  remarks.setRoundsOpen(route.rounds)
  remarks.setSelectedRound(route.rounds ? route.round : null)
}

function unknownPage(id: string) {
  useDesignStore.getState().setError(`Le lien désigne une page qui n’existe pas : ${id}.`)
}

/** Applique une adresse saisie dans la barre d'adresse ou retrouvée par Précédent / Suivant. */
async function applyRoute(route: Route) {
  applying = true
  try {
    const store = useDesignStore.getState()
    if (route.designId !== null && route.designId !== store.design?.id) {
      if (store.designs.some((entry) => entry.id === route.designId)) await store.openDesign(route.designId)
      else unknownPage(route.designId)
    }
    applyRounds(route)
  } finally {
    applying = false
  }
  // Ce qui n'a pas pu être appliqué disparaît de l'adresse.
  writeRoute(true)
}

/**
 * Relie la vue affichée à l'URL : chaque page, la page des retours et chaque
 * retour ont leur adresse, que l'on peut partager, et Précédent / Suivant
 * parcourent les vues visitées.
 */
export function useRouteSync() {
  const design = useDesignStore((state) => state.design)
  const designs = useDesignStore((state) => state.designs)
  const loading = useDesignStore((state) => state.loading)
  const openDesign = useDesignStore((state) => state.openDesign)

  useEffect(() => {
    applyRounds(parseRoute(window.location.hash))

    const unsubscribeDesigns = useDesignStore.subscribe(() => writeRoute())
    const unsubscribeRemarks = useRemarkStore.subscribe(() => writeRoute())
    const onHashChange = () => void applyRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', onHashChange)
    return () => {
      unsubscribeDesigns()
      unsubscribeRemarks()
      window.removeEventListener('hashchange', onHashChange)
    }
  }, [])

  // Sans page ouverte : celle de l'adresse, sinon la dernière ouverte dans ce
  // navigateur si elle existe encore, sinon la première de la barre latérale.
  useEffect(() => {
    if (design || designs.length === 0 || loading) return
    const wanted = parseRoute(window.location.hash).designId
    const first = !started
    started = true
    if (wanted !== null && designs.some((entry) => entry.id === wanted)) {
      void openDesign(wanted)
      return
    }
    // Après la suppression de la page ouverte, l'adresse la désigne encore : seule l'adresse de départ est signalée.
    if (wanted !== null && first) unknownPage(wanted)
    const lastId = readLastDesignId()
    const target = designs.find((entry) => entry.id === lastId) ?? firstDesignOf(buildGroupTree(designs))
    if (target) void openDesign(target.id)
  }, [design, designs, loading, openDesign])
}
