import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Wyprawa — Planowanie Trasy',
  description: 'Wspólne planowanie wyprawy vanem — Słowenia & Budapeszt',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=DM+Sans:wght@300;400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-body bg-stone-950 text-stone-100 min-h-screen">
        {children}
      </body>
    </html>
  )
}
