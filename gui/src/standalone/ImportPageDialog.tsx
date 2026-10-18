import { useState } from 'react'
import { ExchangeError, applyPageImport, parsePageReply, type PageImport } from '@core/exchange'
import { summaryOf } from '@core/design-model'
import { Icon } from '../components/Icon'
import { useDesignStore } from '../store/useDesignStore'
import { copyText } from './files'
import { currentProject, updateProject } from './project'
import { reloadFromProject } from './useLocalChanges'

type Check = { kind: 'ok'; plan: PageImport } | { kind: 'error'; issues: string[]; message: string } | null

function check(text: string): Check {
  if (text.trim() === '') return null
  try {
    return { kind: 'ok', plan: parsePageReply(text, currentProject()) }
  } catch (err) {
    if (err instanceof ExchangeError) return { kind: 'error', issues: err.issues, message: err.message }
    throw err
  }
}

/**
 * Import d'une page renvoyée par ChatGPT : le JSON est vérifié en entier avant
 * tout changement. Un refus liste chaque problème, dans un message prêt à lui
 * être renvoyé.
 */
export function ImportPageDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('')
  const [result, setResult] = useState<Check>(null)
  const [copied, setCopied] = useState(false)
  const [importing, setImporting] = useState(false)

  const verify = (value: string) => {
    setText(value)
    setResult(check(value))
  }

  const loadFile = async (file: File | undefined) => {
    if (file) verify(await file.text())
  }

  const confirmImport = async () => {
    setImporting(true)
    try {
      // Une édition encore en attente doit être enregistrée avant que la page ne soit remplacée.
      await useDesignStore.getState().flushSave()
      const latest = check(text)
      setResult(latest)
      if (latest?.kind !== 'ok') return
      updateProject((project) => applyPageImport(project, latest.plan))
      await reloadFromProject(latest.plan.design.id)
      onClose()
    } catch (err) {
      useDesignStore.getState().setError((err as Error).message)
    } finally {
      setImporting(false)
    }
  }

  const copyIssues = async (message: string) => {
    try {
      await copyText(message)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      useDesignStore.getState().setError((err as Error).message)
    }
  }

  const plan = result?.kind === 'ok' ? result.plan : null
  const lostChanges = plan?.replaces ? summaryOf(plan.replaces).pendingChanges : 0

  return (
    <div className="dialog-backdrop" onPointerDown={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" onPointerDown={(event) => event.stopPropagation()}>
        <div className="dialog-head">
          <h2>Importer une page</h2>
          <button type="button" className="icon-button" title="Fermer" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <p className="dialog-intro">
          Collez la réponse de ChatGPT (le bloc JSON d’une page), ou choisissez un fichier <code>.json</code>.
        </p>

        <textarea
          className="import-text"
          autoFocus
          spellCheck={false}
          placeholder='{ "format": "mcp-design-page", "version": 1, "page": { … } }'
          value={text}
          onChange={(event) => verify(event.target.value)}
        />
        <label className="ghost-button import-file">
          <Icon name="folder-open" size={13} />
          Choisir un fichier
          <input
            type="file"
            accept=".json,application/json,text/plain"
            onChange={(event) => {
              void loadFile(event.target.files?.[0])
              event.target.value = ''
            }}
          />
        </label>

        {result?.kind === 'error' && (
          <div className="import-issues">
            <div className="dialog-row-head">
              <span className="section-label">
                {result.issues.length} problème{result.issues.length > 1 ? 's' : ''} : rien n’a été importé
              </span>
              <button type="button" className="link-button" onClick={() => void copyIssues(result.message)}>
                {copied ? 'Copié' : 'Copier pour ChatGPT'}
              </button>
            </div>
            <pre className="finish-preview">{result.issues.join('\n')}</pre>
          </div>
        )}

        {plan && (
          <div className="import-plan">
            <Icon name="circle-check" size={16} />
            <span>
              {plan.replaces ? (
                <>
                  Remplace la page <strong>« {plan.replaces.name} »</strong>
                </>
              ) : (
                <>
                  Nouvelle page <strong>« {plan.design.name} »</strong>
                </>
              )}{' '}
              · {plan.design.nodes.length} élément{plan.design.nodes.length > 1 ? 's' : ''}
              {plan.processed.length > 0 &&
                ` · ${plan.processed.length} remarque${plan.processed.length > 1 ? 's' : ''} traitée${plan.processed.length > 1 ? 's' : ''}`}
              {lostChanges > 0 && (
                <span className="import-warning">
                  {' '}
                  — {lostChanges} modification{lostChanges > 1 ? 's' : ''} faite{lostChanges > 1 ? 's' : ''} à la main
                  depuis le dernier échange avec ChatGPT ser{lostChanges > 1 ? 'ont' : 'a'} perdue
                  {lostChanges > 1 ? 's' : ''}.
                </span>
              )}
            </span>
          </div>
        )}

        <div className="dialog-foot">
          <button type="button" className="ghost-button" onClick={onClose}>
            Annuler
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!plan || importing}
            onClick={() => void confirmImport()}
          >
            <Icon name="upload" />
            {plan?.replaces ? 'Remplacer la page' : 'Importer la page'}
          </button>
        </div>
      </div>
    </div>
  )
}
