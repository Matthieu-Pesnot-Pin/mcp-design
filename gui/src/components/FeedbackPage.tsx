import { useState } from 'react'
import { PATH_SEPARATOR, roundProgress, type RoundStatus } from '@shared/feedback'
import { useDesignStore } from '../store/useDesignStore'
import { useRemarkStore } from '../store/useRemarkStore'
import { api } from '../utils/api'
import type { FeedbackRound, RoundRemark } from '../types'
import { Icon } from './Icon'

const STATUS_LABELS: Record<RoundStatus, string> = { pending: 'À traiter', in_progress: 'En cours', done: 'Traité' }

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })
}

/**
 * Page des retours : chaque retour transmis, son avancement, et le détail de
 * ses remarques. L'agent déclare ce qu'il a traité avec
 * `mark_feedback_processed` ; l'utilisateur peut aussi cocher ou rouvrir.
 */
export function FeedbackPage() {
  const rounds = useRemarkStore((state) => state.rounds)
  const setRoundsOpen = useRemarkStore((state) => state.setRoundsOpen)
  const setRoundsProcessed = useRemarkStore((state) => state.setRoundsProcessed)
  const ordered = [...rounds].reverse()
  const firstOpen = rounds.find((round) => roundProgress(round).status !== 'done')
  const [selected, setSelected] = useState<number | null>(() => (firstOpen ?? rounds.at(-1))?.number ?? null)
  const round = rounds.find((candidate) => candidate.number === selected) ?? null
  const open = rounds.filter((candidate) => roundProgress(candidate).status !== 'done').length

  return (
    <div className="feedback-page">
      <header className="feedback-page-head">
        <button type="button" className="ghost-button" onClick={() => setRoundsOpen(false)}>
          ← Revenir au canevas
        </button>
        <h1>Retours</h1>
        <span className="remark-hint">
          {rounds.length} retour{rounds.length > 1 ? 's' : ''} · {open} à traiter ou en cours
        </span>
        {open > 0 && (
          <button
            type="button"
            className="ghost-button feedback-page-all"
            onClick={() => {
              if (confirm(`Marquer comme traitées toutes les remarques des ${open} retour(s) en attente ?`))
                void setRoundsProcessed(null, true)
            }}
          >
            <Icon name="check-check" size={13} />
            Tout marquer comme traité
          </button>
        )}
      </header>

      {rounds.length === 0 ? (
        <p className="feedback-empty">
          Aucun retour pour l’instant. Passez en mode Remarques, commentez la planche, puis cliquez sur « Terminer les
          retours ».
        </p>
      ) : (
        <div className="feedback-page-body">
          <ul className="round-list">
            {ordered.map((entry) => (
              <li key={entry.number}>
                <RoundRow round={entry} active={entry.number === selected} onSelect={() => setSelected(entry.number)} />
              </li>
            ))}
          </ul>
          {round && <RoundDetail key={round.number} round={round} />}
        </div>
      )}
    </div>
  )
}

function Progress({ round }: { round: FeedbackRound }) {
  const progress = roundProgress(round)
  return (
    <div className="round-progress">
      <span className="round-status" data-status={progress.status}>
        {STATUS_LABELS[progress.status]}
      </span>
      <span className="round-bar">
        <span style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
      </span>
      <span className="remark-hint">
        {progress.done}/{progress.total}
      </span>
    </div>
  )
}

function RoundRow({ round, active, onSelect }: { round: FeedbackRound; active: boolean; onSelect: () => void }) {
  return (
    <button type="button" className="round-row" data-active={active || undefined} onClick={onSelect}>
      <span className="round-row-title">{round.title}</span>
      <span className="remark-hint">
        n°{round.number} · {formatDate(round.submittedAt)} · {round.remarks.length} remarque
        {round.remarks.length > 1 ? 's' : ''}
      </span>
      <Progress round={round} />
    </button>
  )
}

function RoundDetail({ round }: { round: FeedbackRound }) {
  const renameRound = useRemarkStore((state) => state.renameRound)
  const setRoundsProcessed = useRemarkStore((state) => state.setRoundsProcessed)
  const setRoundsOpen = useRemarkStore((state) => state.setRoundsOpen)
  const setMode = useRemarkStore((state) => state.setMode)
  const openDesign = useDesignStore((state) => state.openDesign)
  const designs = useDesignStore((state) => state.designs)
  const [title, setTitle] = useState(round.title)

  const pages = new Map<string, RoundRemark[]>()
  for (const remark of round.remarks) pages.set(remark.designId, [...(pages.get(remark.designId) ?? []), remark])

  const commitTitle = () => {
    const next = title.trim()
    if (next === '') setTitle(round.title)
    else if (next !== round.title) void renameRound(round.number, next)
  }

  const goTo = async (designId: string) => {
    await openDesign(designId)
    await setMode('remarks')
    setRoundsOpen(false)
  }

  return (
    <section className="round-detail">
      <input
        className="round-title-input"
        aria-label="Nom du retour"
        value={title}
        maxLength={120}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={commitTitle}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            event.stopPropagation()
            setTitle(round.title)
          }
        }}
      />
      <p className="remark-hint">
        Retour n°{round.number} · transmis le {formatDate(round.submittedAt)} · {round.remarks.length} remarque
        {round.remarks.length > 1 ? 's' : ''} sur {pages.size} page{pages.size > 1 ? 's' : ''}
      </p>
      <div className="round-detail-progress">
        <Progress round={round} />
        {roundProgress(round).status === 'done' ? (
          <button type="button" className="ghost-button" onClick={() => void setRoundsProcessed(round.number, false)}>
            Tout rouvrir
          </button>
        ) : (
          <button type="button" className="primary-button" onClick={() => void setRoundsProcessed(round.number, true)}>
            <Icon name="check-check" size={13} />
            Tout marquer comme traité
          </button>
        )}
      </div>

      {[...pages].map(([designId, remarks]) => {
        const exists = designs.some((design) => design.id === designId)
        return (
          <div key={designId} className="round-page">
            <div className="round-page-head">
              <h2>{remarks[0].designName}</h2>
              {exists ? (
                <button type="button" className="link-button" onClick={() => void goTo(designId)}>
                  Ouvrir la page
                </button>
              ) : (
                <span className="remark-hint">page supprimée</span>
              )}
            </div>
            <ul className="round-remarks">
              {remarks.map((remark) => (
                <RoundRemarkRow key={remark.id} round={round.number} remark={remark} />
              ))}
            </ul>
          </div>
        )
      })}
    </section>
  )
}

function targetLabel(remark: RoundRemark): string {
  const target = remark.target
  if (target.kind === 'page') return 'Page entière'
  if (target.kind === 'node') return target.path.join(PATH_SEPARATOR)
  const names = target.elements.map((element) => element.name).join(', ')
  return `Zone ${Math.round(target.box.width)} × ${Math.round(target.box.height)} px${names ? ` · ${names}` : ''}`
}

function RoundRemarkRow({ round, remark }: { round: number; remark: RoundRemark }) {
  const setRemarkProcessed = useRemarkStore((state) => state.setRemarkProcessed)
  const processed = remark.processed

  return (
    <li className="round-remark" data-processed={processed !== null || undefined}>
      <label className="round-remark-check" title={processed ? 'Rouvrir cette remarque' : 'Marquer comme traitée'}>
        <input
          type="checkbox"
          checked={processed !== null}
          onChange={(event) => void setRemarkProcessed(round, remark.id, event.target.checked)}
        />
      </label>
      <div className="round-remark-body">
        <div className="round-remark-head">
          <span className="kind-pill" data-kind={remark.target.kind}>
            {remark.number === null ? 'Page' : `${remark.number} · ${remark.target.kind === 'node' ? 'Élément' : 'Zone'}`}
          </span>
          <span className="round-remark-target">{targetLabel(remark)}</span>
        </div>
        <p className="remark-text">{remark.text}</p>
        <p className="round-remark-state">
          {processed ? (
            <>
              <Icon name="circle-check" size={13} />
              Traitée par {processed.by === 'agent' ? 'l’agent' : 'vous'} le {formatDate(processed.at)}
              {processed.note && <span className="round-remark-note"> — {processed.note}</span>}
            </>
          ) : (
            'À traiter'
          )}
        </p>
      </div>
      {remark.capture && (
        <a className="round-remark-capture" href={api.captureUrl(remark.capture)} target="_blank" rel="noreferrer">
          <img src={api.captureUrl(remark.capture)} alt="Capture" />
        </a>
      )}
    </li>
  )
}
