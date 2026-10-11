import type { Box } from '@shared/tree'
import type { Design, DesignSummary, FeedbackRound, Remark, RemarksState } from '../types'

/** Cible d'une nouvelle remarque ; le serveur la complète d'après le design. */
export type RemarkTargetInput =
  | { kind: 'page' }
  | { kind: 'node'; nodeId: string }
  | { kind: 'area'; box: Box; elementIds: string[] }

/**
 * Les routes sont relatives : la SPA est montée derrière un préfixe de proxy
 * variable, résolu par la balise <base> injectée par le GUI worker.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`api/${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  })

  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try {
      const body = await response.json()
      if (body?.error) message = body.error
    } catch {
      // Réponse non-JSON : le code HTTP reste le meilleur message disponible.
    }
    throw new Error(message)
  }
  return (await response.json()) as T
}

export const api = {
  listDesigns: () => request<DesignSummary[]>('designs'),

  getDesign: (id: string) => request<Design>(`designs/${encodeURIComponent(id)}`),

  createDesign: (input: { name: string; width?: number; height?: number; background?: string; group?: string | null }) =>
    request<{ design: Design; designs: DesignSummary[] }>('designs', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  saveDesign: (design: Design) =>
    request<{ design: Design; designs: DesignSummary[] }>(`designs/${encodeURIComponent(design.id)}`, {
      method: 'PUT',
      body: JSON.stringify({
        // Révision d'origine : le serveur refuse la sauvegarde si le design a
        // avancé entre-temps, plutôt que d'écraser l'autre éditeur.
        revision: design.revision,
        nodes: design.nodes,
        name: design.name,
        width: design.width,
        height: design.height,
        background: design.background,
      }),
    }),

  /** Range une page dans un groupe (chemin "Parent/Enfant"), ou l'en sort avec null. */
  setDesignGroup: (id: string, group: string | null) =>
    request<{ designs: DesignSummary[] }>(`designs/${encodeURIComponent(id)}/group`, {
      method: 'PUT',
      body: JSON.stringify({ group }),
    }),

  /** Copie complète d'une page, rangée dans le même groupe. */
  duplicateDesign: (id: string, name: string) =>
    request<{ design: Design; designs: DesignSummary[] }>(`designs/${encodeURIComponent(id)}/duplicate`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  deleteDesign: (id: string) =>
    request<{ designs: DesignSummary[] }>(`designs/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  listRemarks: () => request<RemarksState>('remarks'),

  addRemark: (input: { designId: string; target: RemarkTargetInput; text: string; capture: boolean }) =>
    request<RemarksState & { remark: Remark }>('remarks', { method: 'POST', body: JSON.stringify(input) }),

  updateRemark: (id: string, text: string) =>
    request<RemarksState & { remark: Remark }>(`remarks/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ text }),
    }),

  deleteRemark: (id: string) => request<RemarksState>(`remarks/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  submitFeedback: (remarkIds: string[], title: string) =>
    request<RemarksState & { round: FeedbackRound }>('feedback', {
      method: 'POST',
      body: JSON.stringify({ remarkIds, title }),
    }),

  renameRound: (round: number, title: string) =>
    request<RemarksState>(`rounds/${round}`, { method: 'PUT', body: JSON.stringify({ title }) }),

  /** Toutes les remarques d'un retour, ou de tous les retours avec null. */
  setRoundsProcessed: (round: number | null, processed: boolean) =>
    request<RemarksState>('feedback/processed', { method: 'POST', body: JSON.stringify({ round, processed }) }),

  setRemarkProcessed: (round: number, remarkId: string, processed: boolean) =>
    request<RemarksState>(`rounds/${round}/remarks/${encodeURIComponent(remarkId)}`, {
      method: 'PUT',
      body: JSON.stringify({ processed }),
    }),

  captureUrl: (name: string) => `api/captures/${encodeURIComponent(name)}`,

  imageUrl: (name: string) => `api/images/${encodeURIComponent(name)}`,
}
