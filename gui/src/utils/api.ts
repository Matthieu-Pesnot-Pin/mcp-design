import type { Design, DesignSummary } from '../types'

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

  createDesign: (input: { name: string; width?: number; height?: number; background?: string }) =>
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

  deleteDesign: (id: string) =>
    request<{ designs: DesignSummary[] }>(`designs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}
