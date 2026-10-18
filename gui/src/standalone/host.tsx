import { COORDINATES_SOURCE } from '@core/exchange'
import type { GuiHost } from '../host'
import { ProjectMenu } from './ProjectMenu'
import { RecapActions } from './RecapActions'

export const STANDALONE_HOST: GuiHost = {
  emptyPagesHint: (
    <>
      Aucune page. Copiez le prompt de création (menu Projet), demandez une page à ChatGPT, puis importez sa réponse
      — ou créez une page ici.
    </>
  ),
  pendingFilterTitle: 'Pages modifiées à la main depuis le dernier échange avec ChatGPT',
  finishIntro:
    'Les remarques cochées sont réunies dans un retour. Vous téléchargerez ensuite son récap pour le transmettre à ChatGPT.',
  finishDone:
    'Téléchargez le récap et déposez ses fichiers dans la conversation ChatGPT. La page « Retours » le propose aussi, et suit le traitement des remarques.',
  finishFootHint: null,
  previewLabel: 'Remarques du récap',
  coordinatesSource: COORDINATES_SOURCE,
  toolbarActions: <ProjectMenu />,
  roundActions: (round) => <RecapActions round={round} />,
}
