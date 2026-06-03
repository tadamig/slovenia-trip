'use client'

import { useEffect, useState } from 'react'

// Przedmioty wpadające do plecaka (krem, powerbank, koszulka, szczoteczka, ładowarka, dokument)
const ITEMS = ['🧴', '🔋', '👕', '🪥', '🔌', '📄']

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
      <div className="relative w-44 h-32">
        {/* spadające przedmioty — kolejno wpadają do plecaka */}
        {ITEMS.map((icon, i) => (
          <span
            key={i}
            className="absolute left-1/2 text-2xl"
            style={{
              top: 0,
              marginLeft: -14,
              animation: `pkFall 2.4s cubic-bezier(.45,.05,.55,.95) ${(i * 0.4).toFixed(2)}s infinite`,
            }}
          >
            {icon}
          </span>
        ))}

        {/* plecak — lekko podskakuje, gdy coś wpada */}
        <span
          className="absolute left-1/2 text-5xl"
          style={{ bottom: 0, marginLeft: -24, animation: 'pkBob 2.4s ease-in-out infinite' }}
        >
          🎒
        </span>
      </div>

      <p className="text-stone-100 text-sm font-medium mt-1 h-5 text-center">{messages[msg]}</p>

      {/* kolorowy pasek (indeterminate) */}
      <div className="h-1.5 w-44 bg-stone-800 rounded-full overflow-hidden mt-3 relative">
        <div
          className="absolute inset-y-0 w-1/2 rounded-full"
          style={{
            background: 'linear-gradient(90deg,#5e9e61,#2cc4ff,#e09f4d)',
            animation: 'pkBar 1.4s ease-in-out infinite',
          }}
        />
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
