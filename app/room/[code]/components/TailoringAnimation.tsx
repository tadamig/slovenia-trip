'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  /** Ustaw na true, gdy dane (miejsca) są już w pamięci. Animacja domknie się efektem „boom". */
  ready?: boolean
  /** Minimalny czas trwania animacji w ms (żeby „boom" nie pojawił się za szybko). */
  minDurationMs?: number
  /** Wywoływane raz, po efekcie „boom" — wtedy chowamy animację i pokazujemy wyniki. */
  onComplete?: () => void
}

// Etapy „szycia wakacji na miarę"
const PHASES = [
  { icon: '🧳', text: 'Pakujemy walizki...',            dot: '#6366f1' },
  { icon: '🚗', text: 'Wybieramy najlepszą trasę...',   dot: '#4ade80' },
  { icon: '✈️', text: 'Sprawdzamy najlepsze miejsca...', dot: '#22d3ee' },
  { icon: '🧵', text: 'Szyjemy plan na miarę ekipy...',  dot: '#fbbf24' },
]

const PHASE_MS = 1600 // czas jednego etapu
const BOOM_HOLD_MS = 1500 // jak długo trzymać „boom" zanim onComplete

// Ścieżka trasy, po której „szyjemy" (jedzie pojazd, ciągnie się nić)
const ROUTE = 'M 18,118 C 70,118 78,60 130,70 C 182,80 188,28 250,40 C 290,48 300,80 322,72'
const ROUTE_LEN = 360

export default function TailoringAnimation({ ready = false, minDurationMs = PHASE_MS * PHASES.length, onComplete }: Props) {
  const [phase, setPhase] = useState(0)        // bieżący etap 0..PHASES.length-1
  const [boom, setBoom] = useState(false)      // pokaż finał „boom"
  const [progress, setProgress] = useState(0)  // 0..100 pasek
  const startRef = useRef<number>(Date.now())
  const completedRef = useRef(false)

  // Przesuwaj etapy automatycznie
  useEffect(() => {
    if (boom) return
    const t = setInterval(() => {
      setPhase((p) => (p < PHASES.length - 1 ? p + 1 : p))
    }, PHASE_MS)
    return () => clearInterval(t)
  }, [boom])

  // Pasek postępu (płynnie do 92%, resztę dopina „boom")
  useEffect(() => {
    if (boom) { setProgress(100); return }
    const t = setInterval(() => {
      setProgress((p) => (p < 92 ? p + 1.4 : p))
    }, 60)
    return () => clearInterval(t)
  }, [boom])

  // Warunek finału: dane gotowe ORAZ minęło minimum czasu
  useEffect(() => {
    if (completedRef.current) return
    const elapsed = Date.now() - startRef.current
    const remaining = Math.max(0, minDurationMs - elapsed)
    if (ready) {
      const t = setTimeout(() => {
        setBoom(true)
        completedRef.current = true
        if (onComplete) setTimeout(onComplete, BOOM_HOLD_MS)
      }, remaining)
      return () => clearTimeout(t)
    }
  }, [ready, minDurationMs, onComplete])

  return (
    <div className="flex flex-col items-center justify-center py-8 px-4">
      <div className="w-full max-w-sm text-center">
        <h3 className="text-stone-100 text-lg font-semibold tracking-tight mb-1">
          {boom ? 'Boom! Plan gotowy 🎉' : 'Szyjemy Twoje wakacje na miarę'}
        </h3>
        <p className="text-xs text-stone-500 mb-5">
          {boom ? 'Twój idealny wyjazd czeka poniżej' : 'Dopasowujemy miejsca pod Waszą ekipę...'}
        </p>

        <div className="relative">
          <svg width="100%" viewBox="0 0 340 150" style={{ display: 'block', overflow: 'visible' }}>
            <defs>
              <linearGradient id="tlrThread" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#6366f1" />
                <stop offset="35%" stopColor="#4ade80" />
                <stop offset="70%" stopColor="#22d3ee" />
                <stop offset="100%" stopColor="#fbbf24" />
              </linearGradient>
            </defs>

            {/* „materiał" — delikatne tło trasy */}
            <path d={ROUTE} fill="none" stroke="#2a2826" strokeWidth="6" strokeLinecap="round" />

            {/* „nić" — szyje się stopniowo */}
            <path
              d={ROUTE}
              fill="none"
              stroke="url(#tlrThread)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={boom ? '0' : '7 6'}
              style={{
                strokeDashoffset: boom ? 0 : ROUTE_LEN * (1 - Math.min(progress, 92) / 92),
                transition: 'stroke-dashoffset .4s linear',
              }}
            />

            {/* pojazd / igła jadąca po trasie */}
            {!boom && (
              <g style={{ animation: 'tlrRide 6.4s linear infinite' }}>
                <circle r="13" fill="#161412" stroke={PHASES[phase].dot} strokeWidth="1.5" />
                <text textAnchor="middle" y="5" fontSize="14">{PHASES[phase].icon}</text>
              </g>
            )}

            {/* finałowy „boom" */}
            {boom && (
              <g>
                {[...Array(10)].map((_, i) => {
                  const a = (i / 10) * Math.PI * 2
                  return (
                    <circle
                      key={i}
                      cx={170 + Math.cos(a) * 8}
                      cy={75 + Math.sin(a) * 8}
                      r="4"
                      fill={['#6366f1', '#4ade80', '#22d3ee', '#fbbf24', '#f472b6'][i % 5]}
                      style={{
                        animation: `tlrBurst .9s cubic-bezier(.2,.8,.2,1) forwards`,
                        ['--bx' as string]: `${Math.cos(a) * 78}px`,
                        ['--by' as string]: `${Math.sin(a) * 58}px`,
                      }}
                    />
                  )
                })}
                <text x="170" y="84" textAnchor="middle" fontSize="34" style={{ animation: 'tlrPop .5s cubic-bezier(.2,1.4,.4,1) forwards' }}>🎉</text>
              </g>
            )}
          </svg>

          <style>{`
            g { offset-rotate: 0deg; }
            @keyframes tlrRide {
              0%   { offset-distance: 0%;   }
              100% { offset-distance: 100%; }
            }
            g[style*="tlrRide"] { offset-path: path('${ROUTE}'); }
            @keyframes tlrBurst {
              0%   { opacity: 1; transform: translate(0,0) scale(1); }
              100% { opacity: 0; transform: translate(var(--bx), var(--by)) scale(.3); }
            }
            @keyframes tlrPop {
              0%   { opacity: 0; transform: scale(.2); }
              100% { opacity: 1; transform: scale(1); }
            }
          `}</style>
        </div>

        {/* pasek postępu */}
        <div className="h-1.5 bg-stone-800 rounded-full overflow-hidden mt-4 mb-3">
          <div
            className="h-full rounded-full"
            style={{
              width: `${progress}%`,
              background: 'linear-gradient(90deg,#6366f1,#4ade80,#22d3ee,#fbbf24,#f472b6)',
              transition: 'width .4s ease',
            }}
          />
        </div>

        {/* aktualny etap */}
        <div className="flex items-center justify-center gap-2 h-5">
          {!boom && (
            <>
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: PHASES[phase].dot, animation: 'tlrDot .9s ease infinite' }}
              />
              <span className="text-xs text-stone-400">{PHASES[phase].text}</span>
            </>
          )}
        </div>

        <style>{`
          @keyframes tlrDot { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(1.4)} }
        `}</style>
      </div>
    </div>
  )
}
