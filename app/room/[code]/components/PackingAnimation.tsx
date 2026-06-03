'use client'

import { useEffect, useRef, useState } from 'react'

// Emotki lecące po łuku i chowające się za klapę narysowanego plecaka.
// Wejście: cała scena pojawia się smooth. Wyjście (gdy ready): plecak płynnie
// odlatuje w górę, a od jego dołu rozwija się "kartka listy" — jeden ciągły ruch.
type Item = { emoji: string; sx: number; r: number }

const ITEMS_PERSONAL: Item[] = [
  { emoji: '👕', sx: -82, r: -22 },
  { emoji: '🧴', sx: 76, r: 28 },
  { emoji: '📕', sx: -54, r: -14 },
  { emoji: '🕶️', sx: 50, r: 18 },
  { emoji: '🔋', sx: -30, r: -8 },
]
const ITEMS_SHARED: Item[] = [
  { emoji: '⛺', sx: -82, r: -22 },
  { emoji: '🍳', sx: 76, r: 28 },
  { emoji: '🔦', sx: -54, r: -14 },
  { emoji: '🧭', sx: 50, r: 18 },
  { emoji: '🪢', sx: -30, r: -8 },
]

const STEP = 0.48 // odstęp między przedmiotami (s)
const DUR = 2.4 // czas lotu jednego przedmiotu (s)
const MIN_MS = 2200 // minimalny czas grania animacji zanim zaczniemy wyjście
const OUTRO_MS = 850 // czas trwania animacji wyjścia

const MESSAGES_PERSONAL = [
  'Pakujemy to co trzeba 🎒',
  'Wrzucamy krem i powerbank...',
  'Niczego nie zapomnimy!',
  'Składamy plecak idealny ✨',
]
const MESSAGES_SHARED = [
  'Kompletujemy wspólny sprzęt 🎒',
  'Pakujemy namiot i resztę ekipy...',
  'Dzielimy się — co kto bierze...',
  'Składamy ekwipunek idealny ✨',
]

interface Props {
  variant?: 'personal' | 'shared'
  ready?: boolean
  onComplete?: () => void
}

export default function PackingAnimation({ variant = 'personal', ready = false, onComplete }: Props) {
  const messages = variant === 'shared' ? MESSAGES_SHARED : MESSAGES_PERSONAL
  const items = variant === 'shared' ? ITEMS_SHARED : ITEMS_PERSONAL
  const [msg, setMsg] = useState(0)
  const [closing, setClosing] = useState(false)

  const startRef = useRef<number>(Date.now())
  const doneRef = useRef(false)

  useEffect(() => {
    const t = setInterval(() => setMsg(m => (m + 1) % messages.length), 1800)
    return () => clearInterval(t)
  }, [messages.length])

  // Gdy lista gotowa — odczekaj minimalny czas, potem zagraj wyjście i zakończ.
  useEffect(() => {
    if (!ready || doneRef.current) return
    const elapsed = Date.now() - startRef.current
    const wait = Math.max(0, MIN_MS - elapsed)
    const startOutro = setTimeout(() => {
      setClosing(true)
      const finish = setTimeout(() => {
        if (!doneRef.current) {
          doneRef.current = true
          onComplete?.()
        }
      }, OUTRO_MS)
      // zachowaj referencję do sprzątnięcia
      ;(startOutro as unknown as { _finish?: ReturnType<typeof setTimeout> })._finish = finish
    }, wait)
    return () => {
      clearTimeout(startOutro)
      const f = (startOutro as unknown as { _finish?: ReturnType<typeof setTimeout> })._finish
      if (f) clearTimeout(f)
    }
  }, [ready, onComplete])

  return (
    <div
      className="flex flex-col items-center justify-center py-10 px-4"
      style={{ animation: 'pkEnter 0.5s cubic-bezier(0.22,0.61,0.36,1) both' }}
    >
      <div className="relative" style={{ width: 200, height: 172 }}>
        {/* GRUPA PLECAKA — przy wyjściu odlatuje w górę i znika */}
        <div
          className="absolute inset-0"
          style={closing ? { animation: `pkBagOut ${OUTRO_MS}ms cubic-bezier(0.4,0,0.6,1) forwards` } : undefined}
        >
          {/* cień pod plecakiem */}
          <div
            aria-hidden
            className="absolute left-1/2 bottom-1 -translate-x-1/2 rounded-[50%] bg-black/30"
            style={{ width: 120, height: 14, filter: 'blur(4px)' }}
          />

          {/* uchwyt */}
          <div
            aria-hidden
            className="absolute left-1/2 -translate-x-1/2 border-[3px] border-b-0 border-forest-700 rounded-t-full"
            style={{ width: 38, height: 22, bottom: 100, zIndex: 0 }}
          />

          {/* korpus plecaka */}
          <div
            className="absolute left-1/2 bottom-0 bg-gradient-to-b from-forest-500 to-forest-600"
            style={{ width: 112, height: 96, borderRadius: 30, transform: 'translateX(-50%)', transformOrigin: 'bottom', animation: closing ? undefined : `pkSquash ${STEP}s ease-in-out infinite`, zIndex: 0 }}
          />

          {/* przedmioty (emotki) wlatujące po łuku — zatrzymujemy je przy wyjściu */}
          {!closing && items.map((it, i) => (
            <span
              key={i}
              className="absolute left-1/2 top-0 block leading-none"
              style={{
                zIndex: 10,
                fontSize: 26,
                transform: 'translateX(-50%)',
                animation: `pkIn ${DUR}s cubic-bezier(.45,.05,.4,1) ${(i * STEP).toFixed(2)}s infinite`,
                ['--sx' as string]: `${it.sx}px`,
                ['--r' as string]: `${it.r}deg`,
              }}
            >
              {it.emoji}
            </span>
          ))}

          {/* obłoczki przy otworze */}
          {!closing && [0, 1, 2].map(i => (
            <span
              key={`p${i}`}
              aria-hidden
              className="absolute rounded-full bg-water-300/70"
              style={{
                left: `calc(50% + ${[-10, 0, 10][i]}px)`,
                top: 70,
                width: 5,
                height: 5,
                zIndex: 10,
                animation: `pkPuff ${STEP}s ease-out ${(i * 0.12).toFixed(2)}s infinite`,
              }}
            />
          ))}

          {/* klapa + sprzączka (na wierzchu — przedmioty chowają się za nią) */}
          <div
            className="absolute left-1/2 bg-forest-700"
            style={{ width: 112, height: 46, borderRadius: 26, transform: 'translateX(-50%)', bottom: 58, zIndex: 20 }}
          />
          <div
            className="absolute left-1/2 bg-sand-400"
            style={{ width: 16, height: 11, borderRadius: 3, transform: 'translateX(-50%)', bottom: 70, zIndex: 20 }}
          />

          {/* przednia kieszeń + zamek */}
          <div
            className="absolute left-1/2 bg-forest-600 border-t border-forest-400/40"
            style={{ width: 82, height: 42, borderRadius: 18, transform: 'translateX(-50%)', bottom: 8, zIndex: 20 }}
          />
          <div
            className="absolute left-1/2 bg-forest-800/70"
            style={{ width: 60, height: 3, borderRadius: 3, transform: 'translateX(-50%)', bottom: 36, zIndex: 20 }}
          />

          {/* poziomy pasek z klamerkami */}
          <div
            className="absolute left-1/2 bg-forest-800/60"
            style={{ width: 112, height: 6, transform: 'translateX(-50%)', bottom: 30, zIndex: 20 }}
          />
          <div className="absolute bg-sand-400" style={{ left: 'calc(50% - 34px)', width: 8, height: 10, borderRadius: 2, bottom: 28, zIndex: 20 }} />
          <div className="absolute bg-sand-400" style={{ left: 'calc(50% + 26px)', width: 8, height: 10, borderRadius: 2, bottom: 28, zIndex: 20 }} />
        </div>

        {/* KARTKA LISTY — rozwija się od dołu plecaka przy wyjściu */}
        {closing && (
          <div
            aria-hidden
            className="absolute left-1/2 bg-gradient-to-b from-stone-100 to-stone-200 shadow-lg"
            style={{
              width: 78,
              bottom: 6,
              borderRadius: 8,
              transformOrigin: 'top center',
              zIndex: 15,
              animation: `pkSheetOut ${OUTRO_MS}ms cubic-bezier(0.22,0.61,0.36,1) forwards`,
            }}
          >
            <div className="px-3 py-2 space-y-1.5">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-sm bg-forest-500/70" />
                  <span className="h-1.5 rounded-full bg-stone-400/70" style={{ width: `${[70, 90, 60, 80][i]}%` }} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <p
        className="text-stone-100 text-sm font-medium mt-3 h-5 text-center"
        style={closing ? { animation: 'pkFade 0.3s ease forwards' } : undefined}
      >
        {closing ? 'Gotowe! ✅' : messages[msg]}
      </p>

      {/* płaski pasek postępu (bez glow) */}
      <div
        className="h-1.5 w-44 bg-stone-800 rounded-full overflow-hidden mt-3 relative"
        style={closing ? { animation: 'pkFade 0.4s ease forwards' } : undefined}
      >
        <div
          className="absolute inset-y-0 w-1/2 rounded-full"
          style={{ background: 'linear-gradient(90deg,#5e9e61,#2cc4ff)', animation: 'pkBar 1.4s ease-in-out infinite' }}
        />
      </div>

      <style>{`
        @keyframes pkEnter {
          0%   { transform: translateY(12px) scale(.96); opacity: 0; }
          100% { transform: translateY(0) scale(1); opacity: 1; }
        }
        @keyframes pkIn {
          0%   { transform: translateX(-50%) translate(var(--sx), -36px) rotate(var(--r)) scale(.65); opacity: 0; }
          12%  { opacity: 1; }
          55%  { transform: translateX(-50%) translate(calc(var(--sx) * .35), 36px) rotate(calc(var(--r) * .4)) scale(1.06); opacity: 1; }
          82%  { transform: translateX(-50%) translate(0px, 76px) rotate(0deg) scale(.82); opacity: 1; }
          100% { transform: translateX(-50%) translate(0px, 90px) rotate(0deg) scale(.4); opacity: 0; }
        }
        @keyframes pkSquash {
          0%, 100% { transform: translateX(-50%) scale(1, 1); }
          50%      { transform: translateX(-50%) scale(1.05, .95); }
        }
        @keyframes pkPuff {
          0%   { transform: translate(-50%, 2px) scale(.3); opacity: 0; }
          35%  { opacity: .6; }
          100% { transform: translate(-50%, -16px) scale(1); opacity: 0; }
        }
        @keyframes pkBar {
          0%   { left: -50%; }
          100% { left: 100%; }
        }
        @keyframes pkBagOut {
          0%   { transform: translateY(0) scale(1); opacity: 1; }
          100% { transform: translateY(-30px) scale(.82); opacity: 0; }
        }
        @keyframes pkSheetOut {
          0%   { transform: translateX(-50%) translateY(-8px) scaleY(0); opacity: 0; }
          35%  { opacity: 1; }
          100% { transform: translateX(-50%) translateY(34px) scaleY(1); opacity: 0; }
        }
        @keyframes pkFade {
          to { opacity: 0; }
        }
      `}</style>
    </div>
  )
}
