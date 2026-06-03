'use client'

import { useEffect, useState } from 'react'

// Przedmioty wpadające do plecaka (krem, powerbank, koszulka, szczoteczka, ładowarka, dokument)
// Każdy dostaje glow w kolorze z rampy forest → water.
const ITEMS: { icon: string; glow: string }[] = [
  { icon: '🧴', glow: 'rgba(94,158,97,0.75)' },
  { icon: '🔋', glow: 'rgba(61,127,65,0.75)' },
  { icon: '👕', glow: 'rgba(44,196,255,0.75)' },
  { icon: '🪥', glow: 'rgba(0,168,239,0.75)' },
  { icon: '🔌', glow: 'rgba(94,158,97,0.75)' },
  { icon: '📄', glow: 'rgba(44,196,255,0.75)' },
]

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
    <div className="flex flex-col items-center justify-center py-8 px-4">
      {/* szklana karta z kolorową poświatą (glass + glow) */}
      <div className="relative">
        <div
          aria-hidden
          className="absolute -inset-3 rounded-3xl bg-gradient-to-br from-forest-500/30 via-water-500/25 to-water-400/30 blur-2xl opacity-80 pointer-events-none"
        />
        <div className="relative rounded-3xl bg-stone-900/40 backdrop-blur-2xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.45)] px-8 py-6 flex flex-col items-center">
          <div className="relative w-44 h-32">
            {/* miękka poświata pod plecakiem */}
            <div
              aria-hidden
              className="absolute left-1/2 bottom-1 w-20 h-20 -ml-10 rounded-full bg-water-400/30 blur-2xl pointer-events-none"
            />

            {/* spadające przedmioty — kolejno wpadają do plecaka, każdy z glow */}
            {ITEMS.map((it, i) => (
              <span
                key={i}
                className="absolute left-1/2 text-2xl"
                style={{
                  top: 0,
                  marginLeft: -14,
                  filter: `drop-shadow(0 0 7px ${it.glow})`,
                  animation: `pkFall 2.4s cubic-bezier(.45,.05,.55,.95) ${(i * 0.4).toFixed(2)}s infinite`,
                }}
              >
                {it.icon}
              </span>
            ))}

            {/* plecak — lekko podskakuje, gdy coś wpada */}
            <span
              className="absolute left-1/2 text-5xl"
              style={{
                bottom: 0,
                marginLeft: -24,
                filter: 'drop-shadow(0 0 10px rgba(44,196,255,0.45))',
                animation: 'pkBob 2.4s ease-in-out infinite',
              }}
            >
              🎒
            </span>
          </div>

          <p className="text-stone-100 text-sm font-medium mt-1 h-5 text-center">{messages[msg]}</p>

          {/* kolorowy pasek (indeterminate) z glow */}
          <div className="h-1.5 w-44 bg-stone-800/80 rounded-full overflow-hidden mt-3 relative">
            <div
              className="absolute inset-y-0 w-1/2 rounded-full"
              style={{
                background: 'linear-gradient(90deg,#5e9e61,#2cc4ff)',
                boxShadow: '0 0 12px rgba(44,196,255,0.6)',
                animation: 'pkBar 1.4s ease-in-out infinite',
              }}
            />
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pkFall {
          0%   { transform: translateY(-6px) scale(1) rotate(-8deg); opacity: 0; }
          12%  { opacity: 1; }
          70%  { transform: translateY(78px) scale(.92) rotate(6deg); opacity: 1; }
          86%  { transform: translateY(94px) scale(.4) rotate(0deg); opacity: 0; }
          100% { transform: translateY(94px) scale(.4); opacity: 0; }
        }
        @keyframes pkBob {
          0%, 70%, 100% { transform: translateY(0); }
          78%           { transform: translateY(3px); }
          86%           { transform: translateY(0); }
        }
        @keyframes pkBar {
          0%   { left: -50%; }
          100% { left: 100%; }
        }
      `}</style>
    </div>
  )
}
