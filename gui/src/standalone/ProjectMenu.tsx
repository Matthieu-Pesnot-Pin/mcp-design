import { useEffect, useRef, useState } from 'react'
import { ExchangeError, creationPrompt, parseProjectFile, projectFileOf } from '@core/exchange'
import { Icon } from '../components/Icon'
import { useDesignStore } from '../store/useDesignStore'
import { copyText, downloadText, today } from './files'
import { ImportPageDialog } from './ImportPageDialog'
import { currentProject, markExported, replaceProject, useProjectStatus } from './project'
import { reloadFromProject } from './useLocalChanges'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })
}

/**
 * Menu « Projet » de la version autonome : échanges avec ChatGPT (prompt,
 * import d'une page) et sauvegarde du projet dans un fichier JSON.
 */
export function ProjectMenu() {
  const [open, setOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [copied, setCopied] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const { changedSinceExport, exportedAt, storageError } = useProjectStatus()
  const fail = (err: unknown) => useDesignStore.getState().setError((err as Error).message)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const copyPrompt = async () => {
    try {
      await copyText(creationPrompt())
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      fail(err)
    }
  }

  const exportProject = async () => {
    setOpen(false)
    try {
      await useDesignStore.getState().flushSave()
      const json = JSON.stringify(projectFileOf(currentProject(), new Date().toISOString()), null, 2)
      downloadText(`mcp-design-projet-${today()}.json`, json, 'application/json')
      markExported()
    } catch (err) {
      fail(err)
    }
  }

  const openProjectFile = async (file: File | undefined) => {
    if (!file) return
    try {
      const project = parseProjectFile(await file.text())
      const message = changedSinceExport
        ? 'Le projet actuel a des modifications non exportées. Les remplacer par ce fichier ?'
        : 'Remplacer le projet actuel par ce fichier ?'
      if (!confirm(message)) return
      replaceProject(project)
      await reloadFromProject()
    } catch (err) {
      if (err instanceof ExchangeError) fail(new Error(`Ce fichier n'est pas un projet valide : ${err.issues.join(' ; ')}`))
      else fail(err)
    }
  }

  return (
    <div ref={container} className="project-menu">
      <button
        type="button"
        className="rounds-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        title={changedSinceExport ? 'Modifications non exportées' : 'Projet'}
      >
        <Icon name="folder-open" />
        Projet
        {(changedSinceExport || storageError) && <span className="pending-dot" data-error={storageError ? true : undefined} />}
      </button>

      {open && (
        <div className="card-menu project-menu-list" role="menu">
          <button type="button" role="menuitem" onClick={() => void copyPrompt()}>
            <Icon name={copied ? 'check' : 'clipboard'} size={15} />
            {copied ? 'Prompt copié' : 'Copier le prompt de création'}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              setImporting(true)
            }}
          >
            <Icon name="upload" size={15} />
            Importer une page…
          </button>
          <hr />
          <button type="button" role="menuitem" onClick={() => void exportProject()}>
            <Icon name="download" size={15} />
            Exporter le projet
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              fileInput.current?.click()
            }}
          >
            <Icon name="folder-open" size={15} />
            Ouvrir un projet…
          </button>
          <p className="project-menu-status">
            {storageError ??
              (exportedAt
                ? `Dernier export : ${formatDate(exportedAt)}${changedSinceExport ? ' · modifié depuis' : ''}`
                : 'Jamais exporté')}
          </p>
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => {
          void openProjectFile(event.target.files?.[0])
          event.target.value = ''
        }}
      />

      {importing && <ImportPageDialog onClose={() => setImporting(false)} />}
    </div>
  )
}
