'use client'

import { useEffect, useState } from 'react'

const CARDS = [
  { icon: '🏔️', label: 'Triglav', color: 'from-forest-900/60 to-forest-800/40' },
  { icon: '🌊', label: 'Soča', color: 'from-water-900/60 to-water-800/40' },
  { icon: '🍽️', label: 'Lokalna kuchnia', color: 'from-sand-900/60 to-sand-800/40' },
  { icon: '📍', label: 'Bled', color: 'from-forest-900/60 to-stone-800/40' },
  { icon: '🏄', label: 'SUP', color: 'from-water-900/60 to-forest-900/40' },
  { icon: '🌅', label: 'Zachód słońca', color: 'from-sand-900/60 to-stone-800/40' },
  { icon: '🥾', label: 'Szlaki', color: 'from-forest-900/60 to-water-900/40' },
  { icon: '🏛️', label: 'Ljubljana', color: 'from-stone-800/60 to-forest-900/40' },
  { icon: '🍺', label: 'Lokalne bary', color: 'from-sand-800/60 to-stone-800/40' },
  { icon: '📸', label: 'Foto spot', color: 'from-water-900/60 to-stone-800/40' },
]

interface FloatingCard {
  id: number
  card: typeof CARDS[0]
  x: number
  delay: number
  duration: number
}

interface Props {
  phase: number
  postsScanned: number
  totalPosts: number
}

const PHASE_LABELS = [
  'Przeszukuję Reddit...',
  'Odebrano dane...',
  'DeepSeek analizuje...',
  'Dopasowuję do ekipy...',
]

export default function GlobeAnimation({ phase, postsScanned }: Props) {
  const [cards, setCards] = useState<FloatingCard[]>([])
  const [tick, setTick] = useState(0)

  useEffect(() => {
    // Stwórz początkowe karty
    const initial: FloatingCard[] = Array.from({ length: 4 }, (_, i) => ({
      id: i,
      card: CARDS[i % CARDS.length],
      x: 15 + i * 22,
      delay: i * 0.4,
      duration: 3 + i * 0.5,
    }))
    setCards(initial)

    const interval = setInterval(() => {
      setTick(t => t + 1)
    }, 1200)

    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    setCards(prev => {
      const newId = Date.now()
      const newCard: FloatingCard = {
        id: newId,
        card: CARDS[newId % CARDS.length],
        x: 8 + Math.random() * 75,
        delay: 0,
        duration: 2.8 + Math.random() * 1.2,
      }
      return [...prev.slice(-5), newCard]
    })
  }, [tick])

  return (
    <div className="flex flex-col items-center py-8 px-4">
      {/* Obszar z kartami */}
      <div className="relative w-full max-w-sm h-40 mb-6 overflow-hidden rounded-2xl bg-gradient-to-b from-stone-900/80 to-stone-950/60 border border-stone-800/60">
        {/* Subtelny gradient na dole */}
        <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-stone-950 to-transparent z-10" />

        {cards.map(fc => (
          <div
            key={fc.id}
            className="absolute bottom-0"
            style={{
              left: `${fc.x}%`,
              animation: `floatUp ${fc.duration}s ease-out ${fc.delay}s forwards`,
            }}
          >
            <div className={`flex items-center gap-1.5 bg-gradient-to-br ${fc.card.color} border border-stone-700/30 backdrop-blur-sm rounded-xl px-2.5 py-1.5 shadow-lg`}>
              <span className="text-base leading-none">{fc.card.icon}</span>
              <span className="text-stone-200 text-xs font-medium whitespace-nowrap">{fc.card.label}</span>
            </div>
          </div>
        ))}

        {/* Pulsujące tło */}
        <div className="absolute inset-0 flex items-center justify-center opacity-5">
          <div className="w-32 h-32 rounded-full border-2 border-forest-400 animate-ping" style={{ animationDuration: '3s' }} />
        </div>
      </div>

      {/* Status */}
      <div className="w-full max-w-sm bg-stone-800/50 border border-stone-700/40 rounded-2xl px-5 py-3.5 mb-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-stone-200 text-sm font-medium">
            {PHASE_LABELS[Math.min(phase, PHASE_LABELS.length - 1)]}
          </p>
          {postsScanned > 0 && (
            <span className="text-forest-400 text-xs font-mono bg-forest-900/30 px-2 py-0.5 rounded-full">
              {postsScanned} postów
            </span>
          )}
        </div>
        {/* Progress dots */}
        <div className="flex gap-1.5">
          {PHASE_LABELS.map((_, i) => (
            <div
              key={i}
              className="h-1 rounded-full transition-all duration-700"
              style={{
                flex: i <= phase ? 2 : 1,
                background: i <= phase ? '#3d7f41' : '#44403c',
              }}
            />
          ))}
        </div>
      </div>

      <p className="text-stone-600 text-xs text-center">
        Szukam ukrytych perełek dopasowanych do Waszej ekipy...
      </p>

      <style>{`
        @keyframes floatUp {
          0% { transform: translateY(0) scale(0.8); opacity: 0; }
          15% { opacity: 1; transform: translateY(-10px) scale(1); }
          80% { opacity: 0.9; }
          100% { transform: translateY(-140px) scale(0.9); opacity: 0; }
        }
      `}</style>
    </div>
  )
}
