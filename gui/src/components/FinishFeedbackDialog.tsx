import { useMemo, useState } from 'react'
import { defaultRoundTitle, formatFeedbackRound, orderRemarks, type RoundRemark } from '@shared/feedback'
import { useDesignStore } from '../store/useDesignStore'
import { draftsOf, useRemarkStore } from '../store/useRemarkStore'
import type { FeedbackRound, Remark } from '../types'
import { Icon } from './Icon'

type Scope = 'page' | 'all'

function kindLabel(remark: Remark): string {
  if (remark.target.kind === 'page') return 'Page'
  return `${remark.number} · ${remark.target.kind === 'node' ? 'Élément' : 'Zone'}`
}

function whereLabel(remark: Remark, designName: string): string {
  if (remark.target.kind === 'node') return `${designName} · ${remark.target.element.id}`
  if (remark.target.kind === 'area') {
    const count = remark.target.elements.length
    return `${designName} · ${count} élément${count > 1 ? 's' : ''}`
  }
  return designName
}

/**
 * « Terminer les retours » : choisit les brouillons à transmettre et les fige
 * dans un retour numéroté, que l'agent lit avec `get_feedback`.
 */
export function FinishFeedbackDialog() {
  const design = useDesignStore((state) => state.design)
  const designs = useDesignStore((state) => state.designs)
  const remarks = useRemarkStore((state) => state.remarks)
  const rounds = useRemarkStore((state) => state.rounds)
  const file = useRemarkStore((state) => state.file)
  const submit = useRemarkStore((state) => state.submit)
  const setFinishOpen = useRemarkStore((state) => state.setFinishOpen)

  const pageDrafts = design ? draftsOf(remarks, design.id) : []
  const [scope, setScope] = useState<Scope>(pageDrafts.length > 0 ? 'page' : 'all')
  const [excluded, setExcluded] = useState<string[]>([])
  const [title, setTitle] = useState(() => defaultRoundTitle(rounds.length + 1))
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState<FeedbackRound | null>(null)

  const names = useMemo(() => new Map(designs.map((entry) => [entry.id, entry.name])), [designs])
  const allDrafts = draftsOf(remarks)
  const listed = orderRemarks(scope === 'page' ? pageDrafts : allDrafts)
  const selected = listed.filter((remark) => !excluded.includes(remark.id))
  const pageCount = new Set(allDrafts.map((remark) => remark.designId)).size

  const roundRemarks: RoundRemark[] = selected.map((remark) => ({
    id: remark.id,
    designId: remark.designId,
    designName: names.get(remark.designId) ?? remark.designId,
    number: remark.number,
    target: remark.target,
    text: remark.text,
    capture: remark.capture,
    processed: null,
  }))
  const preview = formatFeedbackRound({
    number: rounds.length + 1,
    title: title.trim() || defaultRoundTitle(rounds.length + 1),
    submittedAt: new Date().toISOString(),
    remarks: roundRemarks,
  })

  const close = () => setFinishOpen(false)

  const send = async () => {
    setSending(true)
    const round = await submit(
      selected.map((remark) => remark.id),
      title
    )
    setSending(false)
    if (round) setDone(round)
  }

  return (
    <div className="dialog-backdrop" onPointerDown={close}>
      <div className="dialog" role="dialog" aria-modal="true" onPointerDown={(event) => event.stopPropagation()}>
        <div className="dialog-head">
          <h2>Terminer les retours</h2>
          <button type="button" className="icon-button" title="Fermer" onClick={close}>
            <Icon name="x" size={16} />
          </button>
        </div>

        {done ? (
          <div className="dialog-done">
            <Icon name="circle-check" size={28} />
            <p>
              <strong>« {done.title} » enregistré</strong> — retour n°{done.number}, {done.remarks.length} remarque
              {done.remarks.length > 1 ? 's' : ''}.
            </p>
            <p className="remark-hint">
              Dites à l’agent que vous avez terminé : il lira ce retour avec l’outil <code>get_feedback</code>. Les
              remarques restent visibles, marquées transmises ; la page « Retours » suit leur traitement.
            </p>
            <div className="dialog-foot">
              <button type="button" className="primary-button" onClick={close}>
                Fermer
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="dialog-intro">
              Les remarques cochées sont réunies dans un retour que l’agent lira quand vous lui direz que vous avez
              terminé.
            </p>

            <label className="round-title-field">
              <span className="section-label">Nom du retour</span>
              <input
                autoFocus
                value={title}
                maxLength={120}
                placeholder={defaultRoundTitle(rounds.length + 1)}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>

            <span className="section-label">Périmètre</span>
            <div className="scope-choice">
              <button
                type="button"
                data-active={scope === 'page' || undefined}
                disabled={!design}
                onClick={() => setScope('page')}
              >
                <Icon name={scope === 'page' ? 'circle-dot' : 'circle'} size={16} />
                <span>
                  <strong>Cette page</strong>
                  <span className="remark-hint">
                    {design?.name} · {pageDrafts.length} remarque{pageDrafts.length > 1 ? 's' : ''}
                  </span>
                </span>
              </button>
              <button type="button" data-active={scope === 'all' || undefined} onClick={() => setScope('all')}>
                <Icon name={scope === 'all' ? 'circle-dot' : 'circle'} size={16} />
                <span>
                  <strong>Toutes les pages</strong>
                  <span className="remark-hint">
                    {pageCount} page{pageCount > 1 ? 's' : ''} · {allDrafts.length} remarque
                    {allDrafts.length > 1 ? 's' : ''}
                  </span>
                </span>
              </button>
            </div>

            <div className="dialog-row-head">
              <span className="section-label">Remarques à transmettre</span>
              <span className="remark-hint">
                {selected.length} sur {listed.length} sélectionnée{selected.length > 1 ? 's' : ''}
              </span>
            </div>
            <ul className="finish-list">
              {listed.map((remark) => {
                const checked = !excluded.includes(remark.id)
                return (
                  <li key={remark.id}>
                    <label data-off={!checked || undefined}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setExcluded((current) =>
                            checked ? [...current, remark.id] : current.filter((id) => id !== remark.id)
                          )
                        }
                      />
                      <span className="kind-pill" data-kind={remark.target.kind}>
                        {kindLabel(remark)}
                      </span>
                      <span className="finish-text">{remark.text.split('\n')[0]}</span>
                      {remark.capture && <Icon name="image" size={13} />}
                      <span className="finish-where">
                        {whereLabel(remark, names.get(remark.designId) ?? remark.designId)}
                      </span>
                    </label>
                  </li>
                )
              })}
              {listed.length === 0 && <li className="empty-hint">Aucune remarque en attente sur cette page.</li>}
            </ul>

            <div className="dialog-row-head">
              <span className="section-label">Ce que l’agent recevra</span>
              <span className="remark-hint finish-file" title={file}>
                {file}
              </span>
            </div>
            <pre className="finish-preview">{preview}</pre>

            <div className="dialog-foot">
              <span className="remark-hint">
                <Icon name="info" size={13} /> L’agent lit ce retour avec l’outil <code>get_feedback</code>.
              </span>
              <button type="button" className="ghost-button" onClick={close}>
                Retour
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={selected.length === 0 || title.trim() === '' || sending}
                onClick={() => void send()}
              >
                <Icon name="save" />
                {sending ? 'Enregistrement…' : 'Enregistrer le retour'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
