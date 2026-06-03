'use client'

import { useEffect, useState } from 'react'

// Abstrakcyjne przedmioty (NIE emotki) — wlatują z różnych stron po łuku i chowają
// się za klapę plecaka. Płaskie, pogodne kolory; bez glow.
type Item = { w: number; h: number; radius: number; color: string; sx: number; r: number }
const ITEMS: Item[] = [
  { w: 30, h: 16, radius: 999, color: '#5e9e61', sx: -82, r: -22 }, // zwinięte ubranie (forest)
  { w: 14, h: 30, radius: 999, color: '#2cc4ff', sx: 76, r: 28 },   // butelka (water)
  { w: 26, h: 20, radius: 6, color: '#e09f4d', sx: -54, r: -14 },   // książka (sand)
  { w: 20, h: 20, radius: 999, color: '#f472b6', sx: 50, r: 18 },   // piłka (różowy)
  { w: 24, h: 18, radius: 8, color: '#6366f1', sx: -30, r: -8 },    // kosmetyczka (indygo)
]

const STEP = 0.48 // odstęp między przedmiotami (s)
const DUR = 2.4 // czas lotu jednego przedmiotu (s)

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
}

export default function PackingAnimation({ variant = 'personal' }: Props) {
  const messages = variant === 'shared' ? MESSAGES_SHARED : MESSAGES_PERSONAL
  const [msg, setMsg] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setMsg(m => (m + 1) % messages.length), 1800)
    return () => clearInterval(t)
  }, [messages.length])

  return (
    <div className="flex flex-col items-center justify-center py-10 px-4">
      <div className="relative" style={{ width: 200, height: 172 }}>
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
          style={{ width: 112, height: 96, borderRadius: 30, transform: 'translateX(-50%)', transformOrigin: 'bottom', animation: `pkSquash ${STEP}s ease-in-out infinite`, zIndex: 0 }}
        />

        {/* przedmioty wlatujące po łuku (za klapą) */}
        {ITEMS.map((it, i) => (
          <span
            key={i}
            className="absolute left-1/2 top-0"
            style={{
              zIndex: 10,
              animation: `pkIn ${DUR}s cubic-bezier(.45,.05,.4,1) ${(i * STEP).toFixed(2)}s infinite`,
              ['--sx' as string]: `${it.sx}px`,
              ['--r' as string]: `${it.r}deg`,
            }}
          >
            <span
              className="block"
              style={{
                width: it.w,
                height: it.h,
                borderRadius: it.radius,
                background: it.color,
                transform: 'translateX(-50%)',
                boxShadow: 'inset 0 2px 0 rgba(255,255,255,0.25)',
              }}
            />
          </span>
        ))}

        {/* obłoczki przy otworze */}
        {[0, 1, 2].map(i => (
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

      <p className="text-stone-100 text-sm font-medium mt-3 h-5 text-center">{messages[msg]}</p>

      {/* płaski pasek postępu (bez glow) */}
      <div className="h-1.5 w-44 bg-stone-800 rounded-full overflow-hidden mt-3 relative">
        <div
          className="absolute inset-y-0 w-1/2 rounded-full"
          style={{ background: 'linear-gradient(90deg,#5e9e61,#2cc4ff)', animation: 'pkBar 1.4s ease-in-out infinite' }}
        />
      </div>

      <style>{`
        @keyframes pkIn {
          0%   { transform: translate(var(--sx), -36px) rotate(var(--r)) scale(.65); opacity: 0; }
          12%  { opacity: 1; }
          55%  { transform: translate(calc(var(--sx) * .35), 36px) rotate(calc(var(--r) * .4)) scale(1.06); opacity: 1; }
          82%  { transform: translate(0px, 76px) rotate(0deg) scale(.82); opacity: 1; }
          100% { transform: translate(0px, 90px) rotate(0deg) scale(.4); opacity: 0; }
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
      `}</style>
    </div>
  )
}
