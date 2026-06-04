'use client'

import { useEffect } from 'react'
import { RefreshCw } from 'lucide-react'

// Segmentowy error boundary pokoju. Najczęstszy przypadek to ChunkLoadError —
// po nowym deployu stare hashe chunków znikają i lazy-load (np. MapTab) pada.
// Wtedy robimy jednorazowy auto-reload (guard w sessionStorage, by nie wpaść
// w pętlę). Pozostałe błędy pokazują czytelny ciemny ekran zamiast białego
// „Application error".
export default function RoomError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const msg = error?.message || ''
  const isChunkError =
    error?.name === 'ChunkLoadError' ||
    /ChunkLoadError|Loading chunk [\d]+ failed|Loading CSS chunk|error loading dynamically imported module|importing a module script failed/i.test(msg)

  useEffect(() => {
    if (!isChunkError) return
    const KEY = 'chunkReloadedAt'
    const last = Number(sessionStorage.getItem(KEY) || '0')
    // Reload najwyżej raz na 10 s — jeśli problem nie znika, nie zapętlamy.
    if (Date.now() - last > 10000) {
      sessionStorage.setItem(KEY, String(Date.now()))
      window.location.reload()
    }
  }, [isChunkError])

  if (isChunkError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-950">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="w-7 h-7 text-water-400 animate-spin" />
          <p className="text-stone-400 text-sm">Aktualizuję aplikację…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-950 px-4">
      <div className="text-center max-w-sm">
        <div className="text-4xl mb-3">🛠️</div>
        <h2 className="font-display text-xl text-stone-100 mb-2">Coś się posypało</h2>
        <p className="text-stone-500 text-sm mb-6">
          Wystąpił nieoczekiwany błąd przy ładowaniu tej części aplikacji. Spróbuj ponownie — Twoje dane są bezpieczne.
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => reset()}
            className="bg-forest-600 hover:bg-forest-500 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors"
          >
            Spróbuj ponownie
          </button>
          <button
            onClick={() => window.location.reload()}
            className="bg-stone-800 hover:bg-stone-700 text-stone-200 px-5 py-2.5 rounded-xl text-sm font-medium transition-colors"
          >
            Odśwież stronę
          </button>
        </div>
      </div>
    </div>
  )
}
