import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import './standalone.css'
import App from '../App.tsx'
import { HostContext } from '../host'
import { installInterFont } from './fonts'
import { STANDALONE_HOST } from './host'
import { openProject } from './project'

installInterFont()
void openProject()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HostContext.Provider value={STANDALONE_HOST}>
      <App />
    </HostContext.Provider>
  </StrictMode>,
)
