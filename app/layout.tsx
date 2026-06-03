import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Wyprawa — Planowanie Trasy',
  description: 'Wspólne planowanie wyprawy vanem — Słowenia & Budapeszt',
}

// Naprawia mobilny bug: strona odpalała się "przybliżona" (brak width=device-width)
// oraz iOS auto-zoom przy fokusie na input (maximum-scale=1 + inputy ≥16px).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet" />
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      </head>
      <body className="font-body bg-stone-950 text-stone-100 min-h-screen">
        {children}
      </body>
    </html>
  )
}
