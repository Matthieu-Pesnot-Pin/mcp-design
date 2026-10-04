import { useEffect } from 'react'
import { Canvas } from './components/Canvas'
import { DesignSidebar } from './components/DesignSidebar'
import { Inspector } from './components/Inspector'
import { LayerPanel } from './components/LayerPanel'
import { PanelResizer } from './components/PanelResizer'
import { FeedbackPage } from './components/FeedbackPage'
import { FinishFeedbackDialog } from './components/FinishFeedbackDialog'
import { RemarkPanel } from './components/RemarkPanel'
import { Toolbar } from './components/Toolbar'
import { ToolPalette } from './components/ToolPalette'
import { useIPC } from './hooks/useIPC'
import { usePanelWidth } from './hooks/usePanelWidth'
import { usePanelVisible } from './hooks/usePanelVisible'
import { useKeyboard } from './hooks/useKeyboard'
import { useDesignStore } from './store/useDesignStore'
import { useRemarkStore } from './store/useRemarkStore'

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
  const remarking = useRemarkStore((state) => state.mode === 'remarks')
  const finishOpen = useRemarkStore((state) => state.finishOpen)
  const roundsOpen = useRemarkStore((state) => state.roundsOpen)
  const composing = useRemarkStore((state) => state.composer !== null)

  const [leftWidth, setLeftWidth, commitLeftWidth] = usePanelWidth('mcp-design.sidebar-width', 232)
  const [rightWidth, setRightWidth, commitRightWidth] = usePanelWidth('mcp-design.rail-width', 268)
  const [leftVisible, toggleLeft] = usePanelVisible('mcp-design.sidebar-visible')
  const [rightVisible, toggleRight] = usePanelVisible('mcp-design.rail-visible')

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

  // Un panneau masqué disparaît de la grille avec sa poignée : le canvas récupère
  // toute la place, sans colonne résiduelle de 5px.
  const columns = [
    leftVisible ? `${leftWidth}px` : null,
    leftVisible ? '5px' : null,
    'minmax(0, 1fr)',
    rightVisible ? '5px' : null,
    rightVisible ? `${rightWidth}px` : null,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="app" style={{ gridTemplateColumns: columns }}>
      {leftVisible && (
        <>
          <DesignSidebar />
          <PanelResizer side="left" width={leftWidth} onResize={setLeftWidth} onCommit={commitLeftWidth} />
        </>
      )}

      <main className="workspace">
        <Toolbar
          leftVisible={leftVisible}
          rightVisible={rightVisible}
          onToggleLeft={toggleLeft}
          onToggleRight={toggleRight}
        />
        {design ? (
          <>
            <Canvas />
            {!remarking && <ToolPalette />}
            {remarking && !composing && (
              <div className="remark-help">
                Clic : remarque sur un élément · Glisser : remarque sur une zone · Alt + clic : élément exact · Échap :
                quitter
              </div>
            )}
          </>
        ) : (
          <div className="workspace-empty">
            <p>Sélectionnez un design à gauche, ou créez-en un nouveau.</p>
          </div>
        )}
      </main>

      {rightVisible && (
        <>
          <PanelResizer side="right" width={rightWidth} onResize={setRightWidth} onCommit={commitRightWidth} />

          <div className="right-rail">
            {remarking ? (
              <RemarkPanel />
            ) : (
              <>
                <Inspector />
                <LayerPanel />
              </>
            )}
          </div>
        </>
      )}

      {roundsOpen && <FeedbackPage />}
      {finishOpen && <FinishFeedbackDialog />}

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
