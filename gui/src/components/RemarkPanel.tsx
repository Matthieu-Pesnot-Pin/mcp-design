import { useEffect, useRef, useState } from 'react'
import { PATH_SEPARATOR, type Remark } from '@shared/feedback'
import { useDesignStore } from '../store/useDesignStore'
import { draftsOf, useRemarkStore } from '../store/useRemarkStore'
import { api } from '../utils/api'
import { Icon } from './Icon'

/** Rail droit du mode Remarques : les remarques de la page, et l'envoi du retour. */
export function RemarkPanel() {
  const design = useDesignStore((state) => state.design)
  const remarks = useRemarkStore((state) => state.remarks)
  const showSent = useRemarkStore((state) => state.showSent)
  const setShowSent = useRemarkStore((state) => state.setShowSent)
  const composer = useRemarkStore((state) => state.composer)
  const openPageComposer = useRemarkStore((state) => state.openPageComposer)
  const setFinishOpen = useRemarkStore((state) => state.setFinishOpen)

  if (!design) return null

  const ofPage = remarks.filter((remark) => remark.designId === design.id)
  const visible = ofPage.filter((remark) => showSent || remark.status === 'draft')
  const pageRemarks = visible.filter((remark) => remark.target.kind === 'page')
  const pinned = visible
    .filter((remark) => remark.target.kind !== 'page')
    .sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
  const pageDrafts = draftsOf(remarks, design.id).length
  const allDrafts = draftsOf(remarks).length
  const sentCount = ofPage.length - pageDrafts
  const hasPageDraft = ofPage.some((remark) => remark.status === 'draft' && remark.target.kind === 'page')

  return (
    <section className="remarks-panel">
      <div className="remarks-header">
        <h2>Remarques</h2>
        <span className="remark-hint">
          {pageDrafts} non transmise{pageDrafts > 1 ? 's' : ''}
        </span>
      </div>

      <div className="remarks-body">
        {composer?.kind === 'page' ? (
          <PageComposer />
        ) : (
          !hasPageDraft && (
            <button type="button" className="remark-add-page" onClick={openPageComposer}>
              <Icon name="file-plus" />
              Remarque sur toute la page
            </button>
          )
        )}

        {sentCount > 0 && (
          <label className="remark-check">
            <input type="checkbox" checked={showSent} onChange={(event) => setShowSent(event.target.checked)} />
            Afficher les remarques transmises ({sentCount})
          </label>
        )}

        {pageRemarks.length > 0 && (
          <>
            <span className="section-label">Page</span>
            {pageRemarks.map((remark) => (
              <RemarkCard key={remark.id} remark={remark} />
            ))}
          </>
        )}

        {pinned.length > 0 && (
          <>
            <span className="section-label">Éléments et zones</span>
            {pinned.map((remark) => (
              <RemarkCard key={remark.id} remark={remark} />
            ))}
          </>
        )}

        {visible.length === 0 && composer?.kind !== 'page' && (
          <p className="empty-hint">
            Cliquez sur un élément de la planche pour le commenter, ou glissez pour entourer une zone.
          </p>
        )}
      </div>

      <div className="remarks-footer">
        <button type="button" className="primary-button" disabled={allDrafts === 0} onClick={() => setFinishOpen(true)}>
          <Icon name="send" />
          Terminer les retours ({allDrafts})
        </button>
        <span className="remark-hint">Les remarques sont enregistrées au fil de l’eau.</span>
      </div>
    </section>
  )
}

function PageComposer() {
  const composer = useRemarkStore((state) => state.composer)
  const saving = useRemarkStore((state) => state.saving)
  const setText = useRemarkStore((state) => state.setComposerText)
  const closeComposer = useRemarkStore((state) => state.closeComposer)
  const save = useRemarkStore((state) => state.saveComposer)
  if (composer?.kind !== 'page') return null

  return (
    <div className="remark-card" data-editing>
      <div className="remark-card-head">
        <span className="remark-chip">
          <Icon name="file-text" size={12} />
          Page entière
        </span>
      </div>
      <textarea
        autoFocus
        className="remark-textarea"
        rows={3}
        placeholder="Une remarque générale sur cette page…"
        value={composer.text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') closeComposer()
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void save()
        }}
      />
      <div className="remark-card-actions">
        <button type="button" className="ghost-button" onClick={closeComposer}>
          Annuler
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={composer.text.trim() === '' || saving}
          onClick={() => void save()}
        >
          Enregistrer
        </button>
      </div>
    </div>
  )
}

function targetLabel(remark: Remark, missing: boolean): string {
  const target = remark.target
  if (target.kind === 'page') return 'Page entière'
  if (target.kind === 'node') return `${target.path.join(PATH_SEPARATOR)}${missing ? ' · élément supprimé' : ''}`
  return `Zone · ${Math.round(target.box.width)} × ${Math.round(target.box.height)} px`
}

function RemarkCard({ remark }: { remark: Remark }) {
  const design = useDesignStore((state) => state.design)
  const hoveredId = useRemarkStore((state) => state.hoveredId)
  const focusedId = useRemarkStore((state) => state.focusedId)
  const setHovered = useRemarkStore((state) => state.setHovered)
  const setFocused = useRemarkStore((state) => state.setFocused)
  const updateText = useRemarkStore((state) => state.updateText)
  const remove = useRemarkStore((state) => state.remove)
  const round = useRemarkStore((state) => state.rounds.find((candidate) => candidate.number === remark.round))
  const [editing, setEditing] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const focused = remark.id === focusedId
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focused])

  const target = remark.target
  const missing = target.kind === 'node' && !design?.nodes.some((node) => node.id === target.element.id)
  const sent = remark.status === 'sent'
  const processed = round?.remarks.find((entry) => entry.id === remark.id)?.processed ?? null

  const commit = async () => {
    if (editing === null || editing.trim() === '') return
    if (await updateText(remark.id, editing)) setEditing(null)
  }

  return (
    <div
      ref={ref}
      className="remark-card"
      data-status={remark.status}
      data-highlighted={remark.id === hoveredId || focused || undefined}
      onMouseEnter={() => setHovered(remark.id)}
      onMouseLeave={() => setHovered(null)}
      onClick={() => setFocused(remark.id)}
    >
      <div className="remark-card-head">
        {remark.number === null ? (
          <span className="remark-chip">
            <Icon name="file-text" size={12} />
            Page entière
          </span>
        ) : (
          <>
            <span className="remark-number" data-status={remark.status}>
              {remark.number}
            </span>
            <span className="remark-target" title={targetLabel(remark, missing)}>
              <Icon name={target.kind === 'node' ? 'mouse-pointer-click' : 'square-dashed-mouse-pointer'} size={12} />
              <span>{targetLabel(remark, missing)}</span>
            </span>
          </>
        )}
        {!sent && editing === null && (
          <span className="remark-card-tools">
            <button
              type="button"
              className="icon-button"
              title="Modifier"
              onClick={(event) => {
                event.stopPropagation()
                setEditing(remark.text)
              }}
            >
              <Icon name="pencil" />
            </button>
            <button
              type="button"
              className="icon-button"
              title="Supprimer"
              onClick={(event) => {
                event.stopPropagation()
                if (confirm('Supprimer cette remarque ?')) void remove(remark.id)
              }}
            >
              <Icon name="trash-2" />
            </button>
          </span>
        )}
        {sent && (
          <span className="remark-card-tools">
            <button
              type="button"
              className="icon-button"
              title="Retirer de la liste (le retour transmis reste inchangé)"
              onClick={(event) => {
                event.stopPropagation()
                if (confirm('Retirer cette remarque de la liste ? Le retour déjà transmis à l’agent ne change pas.'))
                  void remove(remark.id)
              }}
            >
              <Icon name="trash-2" />
            </button>
          </span>
        )}
      </div>

      {sent && (
        <span className="remark-status" data-processed={processed !== null || undefined}>
          {processed ? 'Traitée' : 'Transmise'} · {round?.title}
        </span>
      )}

      {target.kind === 'area' && (
        <div className="remark-area-info">
          {remark.capture && <img src={api.captureUrl(remark.capture)} alt="Capture de la zone" />}
          <span className="remark-hint">
            {target.elements.length === 0
              ? 'Aucun élément cité'
              : `${target.elements.length} élément${target.elements.length > 1 ? 's' : ''} : ${target.elements
                  .map((element) => element.name)
                  .join(', ')}`}
          </span>
        </div>
      )}

      {editing === null ? (
        <p className="remark-text">{remark.text}</p>
      ) : (
        <>
          <textarea
            autoFocus
            className="remark-textarea"
            rows={3}
            value={editing}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => setEditing(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Escape') setEditing(null)
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void commit()
            }}
          />
          <div className="remark-card-actions">
            <button type="button" className="ghost-button" onClick={() => setEditing(null)}>
              Annuler
            </button>
            <button type="button" className="primary-button" disabled={editing.trim() === ''} onClick={() => void commit()}>
              Enregistrer
            </button>
          </div>
        </>
      )}
    </div>
  )
}
