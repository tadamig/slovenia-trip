'use client'

import { useState } from 'react'
import { supabase, Room, UserPreference } from '@/lib/supabase'
import { getSessionId } from '@/lib/session'
import { Edit2, Users, BarChart2 } from 'lucide-react'
import { useRouter } from 'next/navigation'

const ACTIVITIES_MAP: Record<string, { emoji: string; label: string }> = {
  sup: { emoji: '🏄', label: 'SUP / pływanie' },
  trekking: { emoji: '🥾', label: 'Trekking' },
  food: { emoji: '🍽️', label: 'Lokalne jedzenie' },
  sunset: { emoji: '🌅', label: 'Zachody słońca' },
  van: { emoji: '🏕️', label: 'Nocleg w vanie' },
  sightseeing: { emoji: '🏛️', label: 'Zwiedzanie miast' },
  cycling: { emoji: '🚴', label: 'Rower' },
  relax: { emoji: '🧘', label: 'Relaks' },
  photo: { emoji: '📸', label: 'Fotografia' },
  nightlife: { emoji: '🍺', label: 'Bary / życie nocne' },
  markets: { emoji: '🛒', label: 'Lokalne targi' },
  petfriendly: { emoji: '🐾', label: 'Przyjazne zwierzętom' },
}

const INTENSITY_MAP: Record<string, string> = {
  slow: '🐢 Spokojne', balanced: '⚖️ Zbalansowane', intense: '🔥 Intensywne',
}
const ACCOMMODATION_MAP: Record<string, string> = {
  van_only: '🚐 Tylko van', van_plus: '🏠 Van + noclegi', flexible: '🏨 Elastycznie',
}

interface Props {
  room: Room
  myPrefs: UserPreference
  allPrefs: UserPreference[]
  onReloadPrefs: () => void
}

function aggregateActivities(allPrefs: UserPreference[]): Array<{ id: string; count: number; pct: number }> {
  const total = allPrefs.length
  if (total === 0) return []
  const counts: Record<string, number> = {}
  allPrefs.forEach(p => {
    (p.activities || []).forEach(a => {
      counts[a] = (counts[a] || 0) + 1
    })
  })
  return Object.entries(counts)
    .map(([id, count]) => ({ id, count, pct: Math.round((count / total) * 100) }))
    .sort((a, b) => b.count - a.count)
}

export default function GroupProfile({ room, myPrefs, allPrefs, onReloadPrefs }: Props) {
  const router = useRouter()
  const sid = getSessionId()
  const completedPrefs = allPrefs.filter(p => p.completed)
  const aggregated = aggregateActivities(completedPrefs)
  const highPriority = aggregated.filter(a => a.pct >= 75)
  const medPriority = aggregated.filter(a => a.pct >= 40 && a.pct < 75)

  async function handleEditPrefs() {
    const sid = getSessionId()
    await supabase
      .from('user_preferences')
      .update({ completed: false })
      .eq('room_id', room.id)
      .eq('session_id', sid)
    window.location.reload()
  }

  return (
    <div className="px-4 py-5 max-w-lg mx-auto space-y-5">
      {/* Share prompt */}
      <div className="bg-gradient-to-r from-forest-900/30 to-water-900/20 border border-forest-700/30 rounded-2xl p-4">
        <p className="text-forest-300 text-sm font-medium mb-1">📤 Zaproś ekipę</p>
        <p className="text-stone-400 text-xs leading-relaxed">
          Podziel się kodem <span className="font-mono text-stone-200 bg-stone-800 px-1.5 py-0.5 rounded">{room.code}</span> ze znajomymi lub wyślij link do tej strony. Każda osoba wypełni swoje preferencje.
        </p>
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => navigator.clipboard.writeText(window.location.href)}
            className="text-xs bg-forest-700/40 hover:bg-forest-700/60 border border-forest-600/40 text-forest-300 px-3 py-1.5 rounded-lg transition-colors"
          >
            📋 Kopiuj link
          </button>
        </div>
      </div>

      {/* Members */}
      <div>
        <h3 className="text-xs text-stone-500 font-semibold uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" /> Ekipa ({completedPrefs.length}/{allPrefs.length > 0 ? allPrefs.length : '?'} wypełniło)
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {allPrefs.map(p => (
            <div
              key={p.session_id}
              className={`flex items-center gap-2.5 bg-stone-800/50 border rounded-xl px-3 py-2.5 ${
                p.session_id === sid ? 'border-forest-600/50' : 'border-stone-700/50'
              }`}
            >
              <div className="w-7 h-7 rounded-full bg-stone-700 flex items-center justify-center text-sm font-semibold text-stone-300 flex-shrink-0">
                {p.user_name?.[0]?.toUpperCase() || '?'}
              </div>
              <div className="min-w-0">
                <p className="text-stone-200 text-xs font-medium truncate">
                  {p.user_name} {p.session_id === sid && <span className="text-forest-400">(Ty)</span>}
                </p>
                <p className={`text-xs ${p.completed ? 'text-forest-500' : 'text-stone-600'}`}>
                  {p.completed ? '✓ wypełnione' : '⏳ w trakcie'}
                </p>
              </div>
            </div>
          ))}
          {/* Placeholder dla brakujących */}
          {Array.from({ length: Math.max(0, 4 - allPrefs.length) }).map((_, i) => (
            <div key={`placeholder-${i}`} className="flex items-center gap-2.5 bg-stone-800/20 border border-dashed border-stone-800 rounded-xl px-3 py-2.5">
              <div className="w-7 h-7 rounded-full bg-stone-800 border border-dashed border-stone-700 flex items-center justify-center text-stone-700 text-sm">
                ?
              </div>
              <span className="text-stone-700 text-xs">Czeka na dołączenie</span>
            </div>
          ))}
        </div>
      </div>

      {/* Aggregated activities */}
      {completedPrefs.length > 0 && (
        <div>
          <h3 className="text-xs text-stone-500 font-semibold uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <BarChart2 className="w-3.5 h-3.5" /> Preferencje ekipy
          </h3>

          {highPriority.length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-forest-400 mb-2">🔥 Priorytet wysoki (≥75% ekipy)</p>
              <div className="flex flex-wrap gap-2">
                {highPriority.map(a => {
                  const act = ACTIVITIES_MAP[a.id]
                  return act ? (
                    <div key={a.id} className="flex items-center gap-1.5 bg-forest-800/30 border border-forest-600/40 rounded-xl px-3 py-1.5">
                      <span className="text-base">{act.emoji}</span>
                      <span className="text-forest-300 text-xs font-medium">{act.label}</span>
                      <span className="text-forest-500 text-xs ml-1">{a.count}/{completedPrefs.length}</span>
                    </div>
                  ) : null
                })}
              </div>
            </div>
          )}

          {medPriority.length > 0 && (
            <div className="mb-3">
              <p className="text-xs text-stone-500 mb-2">👍 Popularne w ekipie (40–74%)</p>
              <div className="space-y-1.5">
                {medPriority.map(a => {
                  const act = ACTIVITIES_MAP[a.id]
                  return act ? (
                    <div key={a.id} className="flex items-center gap-2">
                      <span className="w-4 text-center text-sm">{act.emoji}</span>
                      <span className="text-stone-400 text-xs flex-1">{act.label}</span>
                      <div className="flex items-center gap-1.5 w-24">
                        <div className="flex-1 h-1.5 bg-stone-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-stone-500 rounded-full"
                            style={{ width: `${a.pct}%` }}
                          />
                        </div>
                        <span className="text-stone-600 text-xs w-8 text-right">{a.pct}%</span>
                      </div>
                    </div>
                  ) : null
                })}
              </div>
            </div>
          )}

          {/* Intensity & accommodation summary */}
          <div className="grid grid-cols-2 gap-2 mt-4">
            {(['slow', 'balanced', 'intense'] as const).map(opt => {
              const count = completedPrefs.filter(p => p.intensity === opt).length
              if (count === 0) return null
              return (
                <div key={opt} className="bg-stone-800/40 border border-stone-700/40 rounded-xl px-3 py-2.5">
                  <p className="text-stone-400 text-xs">{INTENSITY_MAP[opt]}</p>
                  <p className="text-stone-500 text-xs mt-0.5">{count} {count === 1 ? 'osoba' : 'osoby'}</p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Edit my prefs */}
      <div className="border-t border-stone-800 pt-4">
        <button
          onClick={handleEditPrefs}
          className="w-full flex items-center justify-center gap-2 bg-stone-800 hover:bg-stone-700 border border-stone-700 text-stone-400 hover:text-stone-200 py-3 rounded-xl text-sm transition-colors"
        >
          <Edit2 className="w-4 h-4" /> Edytuj moje preferencje
        </button>
      </div>
    </div>
  )
}
