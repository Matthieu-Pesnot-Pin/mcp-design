import { createContext, useContext, type ReactNode } from 'react'
import type { FeedbackRound } from './types'

/**
 * Ce qui distingue les deux hôtes de l'interface : la GUI servie par le serveur
 * MCP, dont l'agent lit les retours avec ses outils, et le fichier HTML
 * autonome, qui échange des fichiers JSON avec un assistant conversationnel.
 * Les textes qui nomment ce circuit et les actions qui lui sont propres
 * viennent d'ici.
 */
export interface GuiHost {
  /** Liste des pages vide. */
  emptyPagesHint: ReactNode
  /** Infobulle du filtre « À synchroniser ». */
  pendingFilterTitle: string
  /** Introduction de « Terminer les retours ». */
  finishIntro: ReactNode
  /** Message affiché une fois le retour enregistré. */
  finishDone: ReactNode
  /** Note de bas de « Terminer les retours », ou null. */
  finishFootHint: ReactNode | null
  /** Intitulé de l'aperçu du retour. */
  previewLabel: string
  /** Ce qui, pour le destinataire du retour, exprime les coordonnées des remarques. */
  coordinatesSource: string
  /** Actions ajoutées à la barre d'outils. */
  toolbarActions: ReactNode
  /** Actions propres à un retour enregistré. */
  roundActions: ((round: FeedbackRound) => ReactNode) | null
}

export const MCP_HOST: GuiHost = {
  emptyPagesHint: (
    <>
      Aucune page. Créez-en une ici, ou demandez à l'agent d'en générer avec l'outil <code>create_design</code>.
    </>
  ),
  pendingFilterTitle: "Pages modifiées depuis leur dernière récupération par l'agent",
  finishIntro:
    'Les remarques cochées sont réunies dans un retour que l’agent lira quand vous lui direz que vous avez terminé.',
  finishDone: (
    <>
      Dites à l’agent que vous avez terminé : il lira ce retour avec l’outil <code>get_feedback</code>. Les remarques
      restent visibles, marquées transmises ; la page « Retours » suit leur traitement.
    </>
  ),
  finishFootHint: (
    <>
      L’agent lit ce retour avec l’outil <code>get_feedback</code>.
    </>
  ),
  previewLabel: 'Ce que l’agent recevra',
  coordinatesSource: 'get_design',
  toolbarActions: null,
  roundActions: null,
}

export const HostContext = createContext<GuiHost>(MCP_HOST)

export function useHost(): GuiHost {
  return useContext(HostContext)
}
