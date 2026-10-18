import { create } from 'zustand'
import { emptyFeedbackFile } from '@core/feedback-model'
import type { ProjectData } from '@core/exchange'

/**
 * Projet de la version autonome : toutes les pages, les remarques et leurs
 * captures, tenus en mémoire.
 *
 * Le fichier JSON exporté fait foi. Le navigateur en garde en plus une copie
 * (IndexedDB), relue à l'ouverture, pour qu'un rechargement de l'onglet ne
 * perde rien.
 */
export type Project = ProjectData

interface StoredProject {
  project: Project
  /** Date du dernier export JSON, ou null s'il n'y en a jamais eu. */
  exportedAt: string | null
  changedSinceExport: boolean
}

interface ProjectStatus {
  ready: boolean
  exportedAt: string | null
  changedSinceExport: boolean
  /** Échec de lecture ou d'écriture de la copie du navigateur. */
  storageError: string | null
}

export const useProjectStatus = create<ProjectStatus>(() => ({
  ready: false,
  exportedAt: null,
  changedSinceExport: false,
  storageError: null,
}))

const DB_NAME = 'mcp-design-standalone'
const STORE = 'project'
const KEY = 'current'

function emptyProject(): Project {
  return { designs: [], feedback: emptyFeedbackFile(), captures: {} }
}

let project: Project = emptyProject()
let opening: Promise<void> | null = null
let writing: Promise<void> = Promise.resolve()

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB is unavailable.'))
  })
}

async function readStored(): Promise<StoredProject | undefined> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY)
    request.onsuccess = () => resolve(request.result as StoredProject | undefined)
    request.onerror = () => reject(request.error ?? new Error('Lecture impossible.'))
  })
}

async function writeStored(stored: StoredProject): Promise<void> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).put(stored, KEY)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Écriture impossible.'))
  })
}

/** Les écritures partent dans l'ordre des modifications : la dernière gagne toujours. */
function persist() {
  const { exportedAt, changedSinceExport } = useProjectStatus.getState()
  const stored: StoredProject = { project, exportedAt, changedSinceExport }
  writing = writing
    .then(() => writeStored(stored))
    .then(() => useProjectStatus.setState({ storageError: null }))
    .catch((err: unknown) =>
      useProjectStatus.setState({
        storageError: `La copie du navigateur n'a pas pu être enregistrée (${(err as Error).message}). Exportez le projet pour ne rien perdre.`,
      })
    )
}

/** Charge la copie du navigateur, une seule fois. */
export function openProject(): Promise<void> {
  opening ??= readStored()
    .then((stored) => {
      if (stored) project = stored.project
      useProjectStatus.setState({
        ready: true,
        exportedAt: stored?.exportedAt ?? null,
        changedSinceExport: stored?.changedSinceExport ?? false,
      })
    })
    .catch((err: unknown) =>
      useProjectStatus.setState({
        ready: true,
        storageError: `La copie du navigateur est illisible (${(err as Error).message}). Importez le dernier export du projet.`,
      })
    )
  return opening
}

export function currentProject(): Project {
  return project
}

/**
 * Applique une modification. `fn` reçoit une copie : les pages y sont
 * remplacées, jamais modifiées en place, et une exception laisse le projet
 * intact.
 */
export function updateProject<T>(fn: (draft: Project) => T): T {
  const draft: Project = {
    designs: [...project.designs],
    feedback: structuredClone(project.feedback),
    captures: { ...project.captures },
  }
  const result = fn(draft)
  project = draft
  useProjectStatus.setState({ changedSinceExport: true })
  persist()
  return result
}

/** Remplace tout le projet par un export relu : il est alors à jour de cet export. */
export function replaceProject(next: Project) {
  project = next
  useProjectStatus.setState({ changedSinceExport: false, exportedAt: new Date().toISOString() })
  persist()
}

export function markExported() {
  useProjectStatus.setState({ changedSinceExport: false, exportedAt: new Date().toISOString() })
  persist()
}
