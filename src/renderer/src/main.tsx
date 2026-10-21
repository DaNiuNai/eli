import './assets/shadcn.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TooltipProvider } from '@renderer/components/ui/tooltip'
import { ThemeProvider } from '@renderer/components/ThemeProvider'
import { LanguageProvider } from '@renderer/components/LanguageProvider'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import { loadAppPreferences } from '@renderer/lib/app-preferences'
import App from './App'

async function start(): Promise<void> {
  const root = createRoot(document.getElementById('root')!)
  try {
    await loadAppPreferences()
    root.render(
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
  } catch (error) {
    root.render(
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTitle>无法加载设置</AlertTitle>
          <AlertDescription>
            {error instanceof Error ? error.message : String(error)}
          </AlertDescription>
        </Alert>
      </div>
    )
  }
}

void start()
