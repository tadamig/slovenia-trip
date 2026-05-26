'use client'

import { useEffect, useState } from 'react'

interface Props {
  phase: number
  postsScanned: number
  totalPosts: number
}

const STEPS = [
  { color: '#6366f1', dot: '#6366f1', text: 'Łączenie z Reddit...' },
  { color: '#4ade80', dot: '#4ade80', text: 'Pobieranie postów z r/Slovenia, r/travel...' },
  { color: '#22d3ee', dot: '#22d3ee', text: 'DeepSeek analizuje treść postów...' },
  { color: '#fbbf24', dot: '#fbbf24', text: 'Dopasowuję do preferencji ekipy...' },
  { color: '#f472b6', dot: '#f472b6', text: 'Generuję rekomendacje...', pulse: true },
]

const PINS = [
  { cx: 96,  cy: 82,  icon: '🏄', stroke: '#4ade80',  label: 'Bohinj',    lx: 109, ly: 73, lw: 46 },
  { cx: 168, cy: 66,  icon: '🍽️', stroke: '#22d3ee',  label: 'Ljubljana', lx: 118, ly: 48, lw: 44 },
  { cx: 238, cy: 40,  icon: '🌅', stroke: '#fbbf24',  label: 'Bled',      lx: 186, ly: 22, lw: 36 },
  { cx: 292, cy: 24,  icon: '🥾', stroke: '#f472b6',  label: 'Triglav',   lx: 238, ly: 7,  lw: 48 },
]

const SEG_DURATION = 2200
const SEG_DELAY = 500
const PIN_DELAY = 200

export default function GlobeAnimation({ phase, postsScanned }: Props) {
  const [visibleSegs, setVisibleSegs] = useState<number[]>([])
  const [visiblePins, setVisiblePins] = useState<number[]>([])
  const [visibleSteps, setVisibleSteps] = useState<number[]>([])
  const [barWidth, setBarWidth] = useState(0)

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []

    // Segment 1 → Pin 1 → Segment 2 → Pin 2 ...
    PINS.forEach((_, i) => {
      const segStart = SEG_DELAY + i * (SEG_DURATION + PIN_DELAY + 600)
      const pinStart = segStart + SEG_DURATION + PIN_DELAY
      const stepStart = segStart + 200

      timers.push(setTimeout(() => setVisibleSegs(p => [...p, i]), segStart))
      timers.push(setTimeout(() => setVisiblePins(p => [...p, i]), pinStart))
      timers.push(setTimeout(() => setVisibleSteps(p => [...p, i + 1]), stepStart))
    })

    // Krok 0 od razu
    timers.push(setTimeout(() => setVisibleSteps(p => [...p, 0]), 100))

    // Ostatni krok
    const lastStep = SEG_DELAY + PINS.length * (SEG_DURATION + PIN_DELAY + 600) + 400
    timers.push(setTimeout(() => setVisibleSteps(p => [...p, PINS.length]), lastStep))

    // Pasek
    const barTargets = [18, 42, 63, 81, 93]
    barTargets.forEach((target, i) => {
      timers.push(setTimeout(() => setBarWidth(target), SEG_DELAY + i * (SEG_DURATION + PIN_DELAY + 600) + 400))
    })

    return () => timers.forEach(clearTimeout)
  }, [])

  const totalDuration = SEG_DELAY + PINS.length * (SEG_DURATION + PIN_DELAY + 600)

  return (
    <div className="flex flex-col items-center py-4 px-4">
      <div className="w-full max-w-sm">
        <svg width="100%" viewBox="0 0 316 148" style={{ display: 'block', overflow: 'visible', marginBottom: 16 }}>
          <defs>
            <linearGradient id="ag1" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#6366f1"/><stop offset="100%" stopColor="#3d7f41"/>
            </linearGradient>
            <linearGradient id="ag2" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#3d7f41"/><stop offset="100%" stopColor="#0891b2"/>
            </linearGradient>
            <linearGradient id="ag3" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#0891b2"/><stop offset="100%" stopColor="#f59e0b"/>
            </linearGradient>
            <linearGradient id="ag4" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#f59e0b"/><stop offset="100%" stopColor="#ec4899"/>
            </linearGradient>
          </defs>

          {[
            { d: "M 24,128 C 55,128 65,98 96,82", grad: "url(#ag1)" },
            { d: "M 96,82 C 127,66 138,86 168,66", grad: "url(#ag2)" },
            { d: "M 168,66 C 198,46 208,56 238,40", grad: "url(#ag3)" },
            { d: "M 238,40 C 262,27 272,34 292,24", grad: "url(#ag4)" },
          ].map((seg, i) => visibleSegs.includes(i) && (
            <path key={i} d={seg.d} fill="none" stroke={seg.grad} strokeWidth="2.5"
              strokeDasharray="10 7" strokeLinecap="round"
              style={{
                strokeDashoffset: 155,
                animation: `globeDraw 2.2s cubic-bezier(.4,0,.2,1) forwards`,
              }}
            />
          ))}

          <circle cx="24" cy="128" r="5" fill="#6366f1" opacity="0.9">
            <animate attributeName="opacity" values=".9;.4;.9" dur="1.4s" repeatCount="indefinite"/>
          </circle>
          <circle cx="24" cy="128" r="5" fill="none" stroke="#818cf8" strokeWidth="1">
            <animate attributeName="r" values="5;14;5" dur="1.4s" repeatCount="indefinite"/>
            <animate attributeName="opacity" values=".5;0;.5" dur="1.4s" repeatCount="indefinite"/>
          </circle>
          <text x="36" y="132" fontSize="10" fill="#4a4845">Start</text>

          {PINS.map((pin, i) => visiblePins.includes(i) && (
            <g key={i} style={{ animation: 'globePinIn .6s cubic-bezier(.25,.46,.45,.94) forwards' }}>
              <circle cx={pin.cx} cy={pin.cy} r="9" fill="none" stroke={pin.stroke} strokeWidth="1">
                <animate attributeName="r" values="9;22;9" dur="2s" repeatCount="indefinite"/>
                <animate attributeName="opacity" values=".5;0;.5" dur="2s" repeatCount="indefinite"/>
              </circle>
              <circle cx={pin.cx} cy={pin.cy} r="11" fill="#111" stroke={pin.stroke} strokeWidth="1.5"/>
              <text x={pin.cx} y={pin.cy + 4} textAnchor="middle" fontSize="11">{pin.icon}</text>
              <rect x={pin.lx} y={pin.ly} width={pin.lw} height="17" rx="8.5" fill="#161412" stroke="#2a2826" strokeWidth=".5"/>
              <text x={pin.lx + pin.lw / 2} y={pin.ly + 12} textAnchor="middle" fontSize="10" fill="#a8a29e">{pin.label}</text>
            </g>
          ))}
        </svg>

        <div className="flex items-center justify-between mb-2">
          <span className="text-stone-200 text-sm font-medium tracking-tight">Analizuję rekomendacje...</span>
          {postsScanned > 0 && (
            <span className="text-xs text-forest-400 bg-forest-900/30 border border-forest-800/40 px-2.5 py-0.5 rounded-full font-mono">
              {postsScanned} postów
            </span>
          )}
        </div>

        <div className="h-1.5 bg-stone-800 rounded-full overflow-hidden mb-3 relative">
          <div
            className="h-full rounded-full relative"
            style={{
              width: `${barWidth}%`,
              background: 'linear-gradient(90deg,#6366f1,#3d7f41,#0891b2,#f59e0b,#ec4899)',
              transition: 'width 1.5s cubic-bezier(.4,0,.2,1)',
            }}
          />
        </div>

        <div className="flex flex-col gap-1">
          {STEPS.map((step, i) => (
            <div
              key={i}
              className="flex items-center gap-2"
              style={{
                opacity: visibleSteps.includes(i) ? 1 : 0,
                transform: visibleSteps.includes(i) ? 'translateX(0)' : 'translateX(-6px)',
                transition: 'opacity .35s ease, transform .35s ease',
              }}
            >
              <div
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{
                  background: step.dot,
                  animation: step.pulse && visibleSteps.includes(i) ? 'globeDotPulse .9s ease infinite' : 'none',
                }}
              />
              <span className="text-xs" style={{ color: step.pulse && visibleSteps.includes(STEPS.length - 1) ? step.color : '#57534e' }}>
                {step.text}
              </span>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes globeDraw {
          from { stroke-dashoffset: 155; }
          to   { stroke-dashoffset: 0; }
        }
        @keyframes globePinIn {
          0%   { opacity:0; transform:scale(.6) translateY(6px); }
          100% { opacity:1; transform:scale(1) translateY(0); }
        }
        @keyframes globeDotPulse {
          0%,100% { transform:scale(1); opacity:1; }
          50%     { transform:scale(1.4); opacity:.6; }
        }
      `}</style>
    </div>
  )
}
