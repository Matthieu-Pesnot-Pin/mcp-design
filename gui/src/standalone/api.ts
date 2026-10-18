import { normalizeDesignGroup, type Design } from '@shared/schemas/design.schema'
import type { FeedbackFile } from '@shared/schemas/feedback.schema'
import {
  allocateDesignId,
  duplicatedDesign,
  mutatedDesign,
  newDesign,
  sortSummaries,
  summaryOf,
} from '@core/design-model'
import {
  NODE_CAPTURE_PADDING,
  addRemark,
  deleteDesignRemarks,
  deleteRemark,
  renameRound,
  requireRemarkText,
  resolveRemarkTarget,
  setRemarksProcessed,
  submitRound,
  updateRemarkText,
  validatedFeedbackFile,
} from '@core/feedback-model'
import { shortId } from '@core/ids'
import type { api as serverApi } from '../utils/api'
import type { DesignSummary, RemarksState } from '../types'
import { currentProject, openProject, updateProject, type Project } from './project'
import { captureNode, captureRegion } from './rasterize'

/**
 * Remplace l'API HTTP du worker dans la version autonome : mêmes appels, mêmes
 * réponses, servis par le projet en mémoire avec les règles du serveur.
 */

function designOf(project: Project, id: string): Design {
  const design = project.designs.find((candidate) => candidate.id === id)
  if (!design) throw new Error(`Design "${id}" not found.`)
  return design
}

function exists(project: Project, id: string): boolean {
  return project.designs.some((design) => design.id === id)
}

function summaries(project: Project): DesignSummary[] {
  return sortSummaries(project.designs.map(summaryOf))
}

function remarksState(project: Project): RemarksState {
  return { remarks: project.feedback.remarks, rounds: project.feedback.rounds, file: '' }
}

/** JSON aux clés triées : deux objets égaux donnent le même texte, quel que soit l'ordre de leurs clés. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) =>
    entry && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)))
      : entry
  )
}

function sameContent(stored: Design, edited: Pick<Design, 'name' | 'width' | 'height' | 'background' | 'nodes'>) {
  return (
    stored.name === edited.name &&
    stored.width === edited.width &&
    stored.height === edited.height &&
    stored.background === edited.background &&
    stableJson(stored.nodes) === stableJson(edited.nodes)
  )
}

function replaceDesign(project: Project, design: Design) {
  project.designs = project.designs.map((candidate) => (candidate.id === design.id ? design : candidate))
}

/** Modifie le fichier des remarques et le valide, comme le serveur avant d'écrire. */
function updateFeedback<T>(fn: (draft: FeedbackFile, project: Project) => T): T {
  return updateProject((project) => {
    const result = fn(project.feedback, project)
    project.feedback = validatedFeedbackFile(project.feedback)
    return result
  })
}

/** Les captures des brouillons partent avec eux ; celles d'un retour transmis restent. */
function dropDraftCaptures(project: Project, removed: { status: string; capture: string | null }[]) {
  for (const remark of removed) if (remark.status === 'draft' && remark.capture) delete project.captures[remark.capture]
}

async function ready<T>(fn: () => T): Promise<T> {
  await openProject()
  return fn()
}

export const api: typeof serverApi = {
  listDesigns: () => ready(() => summaries(currentProject())),

  getDesign: (id) => ready(() => structuredClone(designOf(currentProject(), id))),

  createDesign: (input) =>
    ready(() =>
      updateProject((project) => {
        const id = allocateDesignId(input.name?.trim() ?? '', (candidate) => exists(project, candidate))
        const design = newDesign(id, input, new Date().toISOString())
        project.designs.push(design)
        return { design, designs: summaries(project) }
      })
    ),

  saveDesign: (design) =>
    ready(() => {
      // Une sauvegarde sans changement (fermeture de l'onglet, export) ne modifie pas le projet.
      const stored = designOf(currentProject(), design.id)
      if (stored.revision === design.revision && sameContent(stored, design)) {
        return { design: stored, designs: summaries(currentProject()) }
      }
      return updateProject((project) => {
        const next = mutatedDesign(
          designOf(project, design.id),
          'user',
          (draft) => {
            draft.nodes = design.nodes
            draft.name = design.name
            draft.width = design.width
            draft.height = design.height
            draft.background = design.background
          },
          { baseRevision: design.revision }
        )
        replaceDesign(project, next)
        return { design: next, designs: summaries(project) }
      })
    }),

  setDesignGroup: (id, group) =>
    ready(() =>
      updateProject((project) => {
        replaceDesign(
          project,
          mutatedDesign(designOf(project, id), 'user', (draft) => {
            draft.group = normalizeDesignGroup(group)
          })
        )
        return { designs: summaries(project) }
      })
    ),

  duplicateDesign: (id, name) =>
    ready(() =>
      updateProject((project) => {
        const source = designOf(project, id)
        const copyName = name.trim() || `${source.name} (copy)`
        const copyId = allocateDesignId(copyName, (candidate) => exists(project, candidate))
        const design = duplicatedDesign(source, copyId, { name: copyName }, new Date().toISOString())
        project.designs.push(design)
        return { design, designs: summaries(project) }
      })
    ),

  deleteDesign: (id) =>
    ready(() =>
      updateFeedback((feedback, project) => {
        designOf(project, id)
        project.designs = project.designs.filter((design) => design.id !== id)
        dropDraftCaptures(project, deleteDesignRemarks(feedback, id))
        return { designs: summaries(project) }
      })
    ),

  listRemarks: () => ready(() => remarksState(currentProject())),

  addRemark: async (input) => {
    await openProject()
    const text = requireRemarkText(input.text)
    const design = designOf(currentProject(), input.designId)
    const target = resolveRemarkTarget(design, input.target)
    const id = shortId('rm')
    const capture = input.capture && target.kind !== 'page' ? `${id}.png` : null
    const png =
      capture === null
        ? null
        : target.kind === 'node'
          ? await captureNode(design, target.element.id, NODE_CAPTURE_PADDING)
          : target.kind === 'area'
            ? await captureRegion(design, target.box)
            : null

    return updateFeedback((feedback, project) => {
      const remark = addRemark(feedback, { id, designId: input.designId, target, text, capture })
      if (capture && png) project.captures[capture] = png
      return { remark, ...remarksState(project) }
    })
  },

  updateRemark: (id, text) =>
    ready(() =>
      updateFeedback((feedback, project) => {
        const remark = updateRemarkText(feedback, id, text)
        return { remark, ...remarksState(project) }
      })
    ),

  deleteRemark: (id) =>
    ready(() =>
      updateFeedback((feedback, project) => {
        dropDraftCaptures(project, [deleteRemark(feedback, id)])
        return remarksState(project)
      })
    ),

  submitFeedback: (remarkIds, title) =>
    ready(() =>
      updateFeedback((feedback, project) => {
        const names = new Map(project.designs.map((design) => [design.id, design.name]))
        const round = submitRound(feedback, remarkIds, title, names)
        return { round, ...remarksState(project) }
      })
    ),

  renameRound: (round, title) =>
    ready(() =>
      updateFeedback((feedback, project) => {
        renameRound(feedback, round, title)
        return remarksState(project)
      })
    ),

  setRoundsProcessed: (round, processed) =>
    ready(() =>
      updateFeedback((feedback, project) => {
        const numbers = round === null ? feedback.rounds.map((entry) => entry.number) : [round]
        for (const number of numbers) setRemarksProcessed(feedback, { round: number, processed, by: 'user' })
        return remarksState(project)
      })
    ),

  setRemarkProcessed: (round, remarkId, processed) =>
    ready(() =>
      updateFeedback((feedback, project) => {
        setRemarksProcessed(feedback, { round, remarkIds: [remarkId], processed, by: 'user' })
        return remarksState(project)
      })
    ),

  captureUrl: (name) => {
    const capture = currentProject().captures[name]
    if (capture === undefined) throw new Error(`Capture "${name}" is missing from the project.`)
    return capture
  },

  imageUrl: (name) => {
    throw new Error(`Image "${name}": the standalone version has no image library.`)
  },
}
