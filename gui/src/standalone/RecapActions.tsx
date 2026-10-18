import { useState } from 'react'
import { strToU8, zipSync } from 'fflate'
import { Icon } from '../components/Icon'
import { useDesignStore } from '../store/useDesignStore'
import type { FeedbackRound } from '../types'
import { copyText, dataUriBytes, downloadBlob } from './files'
import { buildRecap, markRecapSent } from './recap'

/**
 * Transmission d'un retour à ChatGPT : une archive zip qui réunit le fichier
 * texte (remarques, JSON des pages, rappel du format) et les images — vue de
 * chaque page et captures.
 */
export function RecapActions({ round }: { round: FeedbackRound }) {
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const prepare = async () => {
    await useDesignStore.getState().flushSave()
    return buildRecap(round)
  }

  const finish = () => {
    markRecapSent(round)
    void useDesignStore.getState().refreshDesigns()
  }

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    try {
      await action()
    } catch (err) {
      useDesignStore.getState().setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const download = () =>
    run(async () => {
      const recap = await prepare()
      // Les PNG sont déjà compressés : seul le texte gagne à l'être.
      const zip = zipSync({
        [recap.textName]: [strToU8(recap.text), { level: 9 }],
        ...Object.fromEntries(recap.images.map((image) => [image.name, [dataUriBytes(image.href), { level: 0 }]])),
      })
      downloadBlob(recap.zipName, new Blob([zip], { type: 'application/zip' }))
      finish()
    })

  const copy = () =>
    run(async () => {
      const recap = await prepare()
      await copyText(recap.text)
      finish()
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })

  return (
    <div className="recap-actions">
      <button type="button" className="primary-button" disabled={busy} onClick={() => void download()}>
        <Icon name="download" size={13} />
        {busy ? 'Préparation…' : 'Télécharger le récap'}
      </button>
      <button type="button" className="ghost-button" disabled={busy} onClick={() => void copy()}>
        <Icon name={copied ? 'check' : 'copy'} size={13} />
        {copied ? 'Texte copié' : 'Copier le texte'}
      </button>
      <span className="remark-hint">
        Déposez le contenu du <code>.zip</code> (le fichier <code>.md</code> et les images) dans ChatGPT : il
        renverra les pages corrigées, une par réponse, à importer depuis le menu Projet.
      </span>
    </div>
  )
}
