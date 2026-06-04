'use client'

import { useEffect } from 'react'

// Globalny strażnik: jeśli ładowanie chunku JS/CSS padnie POZA renderem
// (np. w handlerze zdarzenia albo jako odrzucona obietnica), robimy jednorazowy
// reload, żeby pobrać świeży build. Render-time przypadki łapie segmentowy
// error boundary (app/room/[code]/error.tsx). Guard w sessionStorage chroni
// przed pętlą.
export default function ChunkErrorReloader() {
  useEffect(() => {
    const isChunkErr = (m?: string) =>
      !!m &&
      /ChunkLoadError|Loading chunk [\d]+ failed|Loading CSS chunk|error loading dynamically imported module|importing a module script failed/i.test(m)

    const reloadOnce = () => {
      const KEY = 'chunkReloadedAt'
      const last = Number(sessionStorage.getItem(KEY) || '0')
      if (Date.now() - last > 10000) {
        sessionStorage.setItem(KEY, String(Date.now()))
        window.location.reload()
      }
    }

    const onError = (e: ErrorEvent) => {
      if (isChunkErr(e?.message) || isChunkErr((e?.error as Error | undefined)?.message)) reloadOnce()
    }
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e?.reason as (Error & { name?: string }) | string | undefined
      const msg = typeof r === 'string' ? r : r?.message
      if (isChunkErr(msg) || (typeof r === 'object' && r?.name === 'ChunkLoadError')) reloadOnce()
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  return null
}
