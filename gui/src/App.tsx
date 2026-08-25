import { useEffect } from 'react'
import { Canvas } from './components/Canvas'
import { DesignSidebar } from './components/DesignSidebar'
import { Inspector } from './components/Inspector'
import { LayerPanel } from './components/LayerPanel'
import { Toolbar } from './components/Toolbar'
import { useIPC } from './hooks/useIPC'
import { useKeyboard } from './hooks/useKeyboard'
import { useDesignStore } from './store/useDesignStore'

export default function App() {
  useIPC()
  useKeyboard()

  const design = useDesignStore((state) => state.design)
  const designs = useDesignStore((state) => state.designs)
  const loading = useDesignStore((state) => state.loading)
  const error = useDesignStore((state) => state.error)
  const openDesign = useDesignStore((state) => state.openDesign)
  const setError = useDesignStore((state) => state.setError)
  const flushSave = useDesignStore((state) => state.flushSave)

  // Ouvre automatiquement le design le plus récent au premier chargement.
  useEffect(() => {
    if (!design && designs.length > 0 && !loading) void openDesign(designs[0].id)
  }, [design, designs, loading, openDesign])

  // Une fermeture d'onglet ne doit pas perdre la dernière modification en attente.
  useEffect(() => {
    const flush = () => void flushSave()
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [flushSave])

  return (
    <div className="app">
      <DesignSidebar />

      <main className="workspace">
        <Toolbar />
        {design ? (
          <Canvas />
        ) : (
          <div className="workspace-empty">
            <p>Sélectionnez un design à gauche, ou créez-en un nouveau.</p>
          </div>
        )}
      </main>

      <div className="right-rail">
        <Inspector />
        <LayerPanel />
      </div>

      {error && (
        <div className="error-toast" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
