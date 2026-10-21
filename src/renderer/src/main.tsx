import './assets/shadcn.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TooltipProvider } from '@renderer/components/ui/tooltip'
import { ThemeProvider } from '@renderer/components/ThemeProvider'
import { LanguageProvider } from '@renderer/components/LanguageProvider'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageProvider>
      <ThemeProvider>
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </ThemeProvider>
    </LanguageProvider>
  </StrictMode>
)
