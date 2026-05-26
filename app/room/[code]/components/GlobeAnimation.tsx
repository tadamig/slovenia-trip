'use client'

import { useEffect, useState } from 'react'

interface Pin {
  id: number
  cx: number
  cy: number
  label: string
  visible: boolean
}

const PLACES = [
  'Bled', 'Soča', 'Ljubljana', 'Piran', 'Triglav',
  'Bohinj', 'Kobarid', 'Budapeszt', 'Maribor', 'Koper',
  'Kranjska Gora', 'Portorož', 'Vogel', 'Bovec',
]

interface Props {
  phase: number
  postsScanned: number
  totalPosts: number
}

export default function GlobeAnimation({ phase, postsScanned, totalPosts }: Props) {
  const [pins, setPins] = useState<Pin[]>([])
  const [rotation, setRotation] = useState(0)
  const [counter, setCounter] = useState(0)

  useEffect(() => {
    const rotTimer = setInterval(() => {
      setRotation(r => (r + 0.4) % 360)
    }, 16)
    return () => clearInterval(rotTimer)
  }, [])

  useEffect(() => {
    const pinTimer = setInterval(() => {
      const label = PLACES[Math.floor(Math.random() * PLACES.length)]
      const angle = Math.random() * Math.PI * 2
      const r = Math.random() * 55 + 10
      const cx = 90 + Math.cos(angle) * r
      const cy = 90 + Math.sin(angle) * r * 0.45
      const id = Date.now()

      setPins(prev => [...prev.slice(-8), { id, cx, cy, label, visible: true }])

      setTimeout(() => {
        setPins(prev => prev.map(p => p.id === id ? { ...p, visible: false } : p))
      }, 2500)
    }, 700)
    return () => clearInterval(pinTimer)
  }, [])

  useEffect(() => {
    if (postsScanned === 0) return
    const t = setInterval(() => {
      setCounter(c => Math.min(c + 1, postsScanned))
    }, 80)
    return () => clearInterval(t)
  }, [postsScanned])

  const phaseLabels = [
    '🛰️ Skanowanie Reddit...',
    '📡 Odebrano dane...',
    '🧠 Analizuję posty...',
    '📍 Mapowanie miejsc...',
  ]

  // Siatka kuli — południki i równoleżniki
  const meridians = Array.from({ length: 8 }, (_, i) => {
    const angle = (i / 8) * 360 + rotation
    const rad = (angle * Math.PI) / 180
    const rx = Math.abs(Math.cos(rad)) * 78
    return { rx, key: i, opacity: 0.15 + Math.abs(Math.cos(rad)) * 0.35 }
  })

  const parallels = [-50, -30, -10, 10, 30, 50]

  return (
    <div className="flex flex-col items-center py-6 px-4 select-none">
      {/* Kula */}
      <div className="relative mb-5">
        <svg width="180" height="180" viewBox="0 0 180 180">
          <defs>
            <radialGradient id="globeGrad" cx="40%" cy="35%">
              <stop offset="0%" stopColor="#2d6331" stopOpacity="0.9" />
              <stop offset="60%" stopColor="#1a341d" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#0f1f10" stopOpacity="1" />
            </radialGradient>
            <radialGradient id="shineGrad" cx="35%" cy="30%">
              <stop offset="0%" stopColor="#5e9e61" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#5e9e61" stopOpacity="0" />
            </radialGradient>
            <clipPath id="globeClip">
              <circle cx="90" cy="90" r="78" />
            </clipPath>
          </defs>

          {/* Tło kuli */}
          <circle cx="90" cy="90" r="78" fill="url(#globeGrad)" />

          {/* Siatka — równoleżniki */}
          <g clipPath="url(#globeClip)" opacity="0.3">
            {parallels.map((y, i) => (
              <ellipse
                key={i}
                cx="90"
                cy={90 + y * 0.9}
                rx="78"
                ry={Math.abs(Math.cos((y * Math.PI) / 180)) * 20 + 5}
                fill="none"
                stroke="#3d7f41"
                strokeWidth="0.8"
              />
            ))}
          </g>

          {/* Siatka — południki (obracają się) */}
          <g clipPath="url(#globeClip)">
            {meridians.map(m => (
              <ellipse
                key={m.key}
                cx="90"
                cy="90"
                rx={m.rx}
                ry="78"
                fill="none"
                stroke="#3d7f41"
                strokeWidth="0.8"
                opacity={m.opacity}
              />
            ))}
          </g>

          {/* Połysk */}
          <circle cx="90" cy="90" r="78" fill="url(#shineGrad)" />

          {/* Ramka */}
          <circle cx="90" cy="90" r="78" fill="none" stroke="#3d7f41" strokeWidth="1.5" opacity="0.6" />

          {/* Pinezki */}
          {pins.map(pin => (
            <g
              key={pin.id}
              style={{
                transition: 'opacity 0.4s ease',
                opacity: pin.visible ? 1 : 0,
              }}
            >
              <circle cx={pin.cx} cy={pin.cy} r="3" fill="#3d7f41" />
              <circle cx={pin.cx} cy={pin.cy} r="6" fill="none" stroke="#3d7f41" strokeWidth="1" opacity="0.5">
                <animate attributeName="r" values="3;10;3" dur="1.5s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.5;0;0.5" dur="1.5s" repeatCount="indefinite" />
              </circle>
              <line x1={pin.cx} y1={pin.cy - 3} x2={pin.cx} y2={pin.cy - 10} stroke="#5e9e61" strokeWidth="0.8" />
            </g>
          ))}
        </svg>

        {/* Etykiety pinezek */}
        {pins.filter(p => p.visible).slice(-3).map(pin => (
          <div
            key={pin.id}
            className="absolute text-xs text-forest-300 bg-stone-900/80 px-1.5 py-0.5 rounded-full border border-forest-700/30 whitespace-nowrap pointer-events-none animate-fade-up"
            style={{
              left: `${(pin.cx / 180) * 100}%`,
              top: `${(pin.cy / 180) * 100 - 15}%`,
              transform: 'translate(-50%, -100%)',
            }}
          >
            {pin.label}
          </div>
        ))}
      </div>

      {/* Status */}
      <div className="flex items-center gap-3 bg-stone-800/60 border border-stone-700/40 rounded-2xl px-5 py-3 mb-3 w-full max-w-xs">
        <div className="flex-1">
          <p className="text-stone-200 text-sm font-medium">
            {phaseLabels[Math.min(phase, phaseLabels.length - 1)]}
          </p>
          <div className="flex gap-1 mt-2">
            {phaseLabels.map((_, i) => (
              <div
                key={i}
                className="h-1 rounded-full transition-all duration-500"
                style={{
                  width: i <= phase ? '24px' : '8px',
                  background: i <= phase ? '#3d7f41' : '#44403c',
                }}
              />
            ))}
          </div>
        </div>
        {postsScanned > 0 && (
          <div className="text-right flex-shrink-0">
            <p className="text-forest-400 text-lg font-bold font-mono">{counter}</p>
            <p className="text-stone-600 text-xs">postów</p>
          </div>
        )}
      </div>

      <p className="text-stone-600 text-xs text-center">
        Szukam ukrytych perełek Słowenii i Budapesztu...
      </p>
    </div>
  )
}
