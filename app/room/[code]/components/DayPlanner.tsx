'use client'

import { useEffect, useMemo, useState } from 'react'
import { ItineraryItem, SavedPlace, DayInsightPayload } from '@/lib/supabase'
import { NewStop } from './useItinerary'
import {
  dateForDay, formatDayDate, openingLineForDate, isOpenAt, OpenState,
  summarizeFeasibility, formatDuration, DAY_BUDGET_MIN,
  fetchDayWeather, weatherEmoji, weatherHint, DayWeather,
} from './itineraryUtils'
import {
  ChevronUp, ChevronDown, Trash2, Plus, Clock, MapPin, Ruler, AlertTriangle, X, Sparkles, Car, Lightbulb, RefreshCw,
} from 'lucide-react'

const ACTIVITY_TAGS: Record<string, string> = {
  sup: '🏄 SUP', trekking: '🥾 Trekking', food: '🍽️ Jedzenie', sunset: '🌅 Widok',
  sightseeing: '🏛️ Zwiedzanie', relax: '🧘 Relaks', photo: '📸 Foto', markets: '🛒 Targi', nightlife: '🍺 Nocne życie',
}

const DURATION_PRESETS = [30, 60, 90, 120, 180]

export type Leg = { distanceText: string; durationMin: number }

// Polecajka w okolicy dnia (z silnika discover).
export type NearbyRec = {
  name: string
  googlePlaceId: string
  lat: number
  lon: number
  tags: string[]
  openingHours?: string[]
  googleRating?: number
  distanceFromBase?: number
}

interface Props {
  startDate: string | null
  days: number
  selectedDay: number
  onSelectDay: (d: number) => void
  onAddDay: () => void
  onRemoveDay: (d: number) => void
  dayCounts: number[]            // liczba przystanków w każdym dniu (do badge'y)
  dayItems: ItineraryItem[]      // przystanki wybranego dnia (posortowane)
  legs: Leg[]                    // odcinki między kolejnymi przystankami wybranego dnia
  routeLoading: boolean
  savedPlaces: SavedPlace[]
  onAddStop: (stop: NewStop) => void
  onRemoveStop: (id: string) => void
  onMoveWithinDay: (id: string, dir: -1 | 1) => void
  onMoveToDay: (id: string, dayIndex: number) => void
  onUpdateStop: (id: string, patch: Partial<Pick<ItineraryItem, 'duration_min' | 'start_time'>>) => void
  onFocusPlace: (lat: number, lon: number) => void
  insight: DayInsightPayload | null
  insightFresh: boolean
  insightLoading: boolean
  onAnalyze: () => void
  nearby: NearbyRec[]
  nearbyLoading: boolean
  onAddNearby: (rec: NearbyRec) => void
}

function savedToStop(sp: SavedPlace): NewStop {
  const c = sp.place_data?.coordinates
  return {
    place_name: sp.place_name,
    place_id: sp.place_data?.place_id ?? null,
    lat: Array.isArray(c) ? c[0] : null,
    lon: Array.isArray(c) ? c[1] : null,
    saved_place_id: sp.id,
    opening_hours: sp.place_data?.opening_hours ?? null,
    tags: (sp.tags as string[]) || [],
  }
}

function openBadge(state: OpenState, line: string | null) {
  if (state === 'open') return <span className="text-emerald-400">🟢 otwarte · {line}</span>
  if (state === 'closed') return <span className="text-rose-400">🔴 {line || 'zamknięte'}</span>
  if (line) return <span className="text-stone-500">🕒 {line}</span>
  return null
}

export default function DayPlanner({
  startDate, days, selectedDay, onSelectDay, onAddDay, onRemoveDay, dayCounts,
  dayItems, legs, routeLoading, savedPlaces,
  onAddStop, onRemoveStop, onMoveWithinDay, onMoveToDay, onUpdateStop, onFocusPlace,
  insight, insightFresh, insightLoading, onAnalyze,
  nearby, nearbyLoading, onAddNearby,
}: Props) {
  const [picker, setPicker] = useState(false)
  const [weather, setWeather] = useState<DayWeather | null>(null)

  const dayDate = dateForDay(startDate, selectedDay)

  // Pogoda dnia — dla pierwszego przystanku ze współrzędnymi.
  useEffect(() => {
    let cancelled = false
    setWeather(null)
    const first = dayItems.find((it) => it.lat != null && it.lon != null)
    if (!first || !dayDate) return
    fetchDayWeather(first.lat!, first.lon!, dayDate).then((w) => {
      if (!cancelled) setWeather(w)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDay, dayItems.map((it) => `${it.lat},${it.lon}`).join('|'), startDate])

  // Wykonalność dnia.
  const feasibility = useMemo(() => {
    const driveMin = legs.reduce((s, l) => s + l.durationMin, 0)
    const visitMin = dayItems.reduce((s, it) => s + (it.duration_min || 0), 0)
    let closedCount = 0
    for (const it of dayItems) {
      const line = openingLineForDate(it.opening_hours, dayDate)
      if (isOpenAt(line, it.start_time) === 'closed') closedCount++
    }
    return summarizeFeasibility(driveMin, visitMin, closedCount)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legs, dayItems, startDate, selectedDay])

  // Miejsca dostępne do dodania (mają współrzędne, jeszcze nie w tym dniu).
  const inDayIds = new Set(dayItems.map((it) => it.saved_place_id).filter(Boolean))
  const addable = savedPlaces.filter((sp) => {
    const c = sp.place_data?.coordinates
    return Array.isArray(c) && typeof c[0] === 'number' && !inDayIds.has(sp.id)
  })

  return (
    <div className="bg-stone-900 border-t border-stone-800">
      {/* Pasek dni */}
      <div className="flex items-center gap-1.5 px-3 py-2.5 overflow-x-auto border-b border-stone-800/70">
        {Array.from({ length: days }).map((_, d) => {
          const date = dateForDay(startDate, d)
          const active = d === selectedDay
          const cnt = dayCounts[d] || 0
          return (
            <button
              key={d}
              onClick={() => onSelectDay(d)}
              className={`flex-shrink-0 flex flex-col items-center px-3 py-1.5 rounded-xl text-center transition-all border ${
                active
                  ? 'bg-gradient-to-br from-forest-600/80 to-water-600/70 text-white border-white/20'
                  : 'bg-stone-800/40 text-stone-400 border-stone-700/30 hover:text-stone-200'
              }`}
            >
              <span className="text-xs font-semibold leading-none">Dzień {d + 1}{cnt > 0 ? ` · ${cnt}` : ''}</span>
              {date && (
                <span className="text-[10px] opacity-80 leading-none mt-0.5">
                  {date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })}
                </span>
              )}
            </button>
          )
        })}
        <button
          onClick={onAddDay}
          className="flex-shrink-0 w-8 h-8 rounded-xl bg-stone-800/40 border border-stone-700/30 text-stone-400 hover:text-stone-200 flex items-center justify-center"
          title="Dodaj dzień"
        >
          <Plus className="w-4 h-4" />
        </button>
        {/* Usuń ostatni dzień — tylko gdy pusty (nie kasujemy zaplanowanych przystanków) */}
        {days > 1 && (dayCounts[days - 1] || 0) === 0 && (
          <button
            onClick={() => onRemoveDay(days - 1)}
            className="flex-shrink-0 w-8 h-8 rounded-xl bg-stone-800/40 border border-stone-700/30 text-stone-500 hover:text-rose-400 flex items-center justify-center"
            title="Usuń ostatni (pusty) dzień"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Nagłówek dnia: data + pogoda + wykonalność */}
      <div className="px-4 pt-3 pb-1 flex items-center justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <p className="text-stone-200 text-sm font-semibold capitalize truncate">
            {dayDate ? formatDayDate(dayDate) : `Dzień ${selectedDay + 1}`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {weather && (
            <span className="text-xs text-stone-300 bg-stone-800/60 border border-stone-700/40 rounded-full px-2.5 py-1">
              {weatherEmoji(weather.weatherCode)} {weather.tempMax}° / {weather.tempMin}°
              {weather.precipitation >= 0.5 ? ` · 💧${weather.precipitation.toFixed(1)}mm` : ''}
            </span>
          )}
          {dayItems.length > 0 && (
            <span
              className={`text-xs rounded-full px-2.5 py-1 border ${
                feasibility.overBudget
                  ? 'text-amber-400 bg-amber-900/20 border-amber-700/40'
                  : 'text-emerald-400 bg-emerald-900/20 border-emerald-700/30'
              }`}
            >
              {feasibility.overBudget ? '⚠️ ' : '✅ '}
              {formatDuration(feasibility.totalMin)} dnia
            </span>
          )}
        </div>
      </div>

      {/* Ostrzeżenia */}
      {dayItems.length > 0 && (feasibility.overBudget || feasibility.closedCount > 0) && (
        <div className="px-4 pb-1 space-y-1">
          {feasibility.overBudget && (
            <p className="text-xs text-amber-400/90 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              Dzień przeładowany (~{formatDuration(feasibility.totalMin)} przy budżecie {formatDuration(DAY_BUDGET_MIN)}) —
              rozważ przeniesienie przystanku na inny dzień.
            </p>
          )}
          {feasibility.closedCount > 0 && (
            <p className="text-xs text-rose-400/90 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              {feasibility.closedCount} {feasibility.closedCount === 1 ? 'miejsce' : 'miejsca'} mogą być zamknięte o planowanej porze.
            </p>
          )}
        </div>
      )}

      {/* Lista przystanków dnia */}
      <div className="px-4 pt-2 pb-3">
        {dayItems.length === 0 ? (
          <p className="text-stone-600 text-xs bg-stone-800/30 border border-dashed border-stone-700/40 rounded-xl px-3 py-4 text-center">
            Pusty dzień. Dodaj zapisane miejsca przyciskiem poniżej — policzę trasę, czasy i sprawdzę, czy się wyrobicie.
          </p>
        ) : (
          <div className="space-y-1.5">
            {dayItems.map((it, i) => {
              const line = openingLineForDate(it.opening_hours, dayDate)
              const openState = isOpenAt(line, it.start_time)
              const leg = legs[i] // odcinek DO następnego przystanku
              return (
                <div key={it.id}>
                  <div className="bg-stone-800/40 border border-stone-700/30 rounded-xl px-3 py-2.5">
                    <div className="flex items-start gap-2.5">
                      <button
                        onClick={() => it.lat != null && it.lon != null && onFocusPlace(it.lat, it.lon)}
                        className="w-6 h-6 rounded-full bg-forest-600 flex items-center justify-center text-xs font-bold text-white flex-shrink-0 mt-0.5"
                        title="Pokaż na mapie"
                      >
                        {i + 1}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className="text-stone-100 text-sm font-medium truncate">{it.place_name}</p>
                        {(it.tags as string[])?.length > 0 && (
                          <p className="text-stone-500 text-xs truncate">
                            {(it.tags as string[]).map((t) => ACTIVITY_TAGS[t] || t).join(' · ')}
                          </p>
                        )}
                        <p className="text-xs mt-0.5">{openBadge(openState, line)}</p>
                      </div>
                      {/* Reorder + usuń */}
                      <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
                        <button
                          onClick={() => onMoveWithinDay(it.id, -1)}
                          disabled={i === 0}
                          className="text-stone-500 hover:text-stone-200 disabled:opacity-25"
                        >
                          <ChevronUp className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => onMoveWithinDay(it.id, 1)}
                          disabled={i === dayItems.length - 1}
                          className="text-stone-500 hover:text-stone-200 disabled:opacity-25"
                        >
                          <ChevronDown className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Czas zwiedzania + godzina startu + przenieś do dnia */}
                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                      <Clock className="w-3 h-3 text-stone-600" />
                      {DURATION_PRESETS.map((m) => (
                        <button
                          key={m}
                          onClick={() => onUpdateStop(it.id, { duration_min: m })}
                          className={`text-[11px] px-1.5 py-0.5 rounded-md border ${
                            (it.duration_min || 0) === m
                              ? 'bg-forest-600/70 text-white border-forest-500/50'
                              : 'bg-stone-800/60 text-stone-400 border-stone-700/40 hover:text-stone-200'
                          }`}
                        >
                          {m < 60 ? `${m}m` : `${m / 60}h`}
                        </button>
                      ))}
                      <input
                        type="time"
                        value={it.start_time || ''}
                        onChange={(e) => onUpdateStop(it.id, { start_time: e.target.value || null })}
                        className="text-[11px] bg-stone-800/60 text-stone-300 border border-stone-700/40 rounded-md px-1.5 py-0.5 ml-auto"
                        title="Planowana godzina"
                      />
                      <select
                        value={selectedDay}
                        onChange={(e) => onMoveToDay(it.id, parseInt(e.target.value, 10))}
                        className="text-[11px] bg-stone-800/60 text-stone-400 border border-stone-700/40 rounded-md px-1 py-0.5"
                        title="Przenieś do dnia"
                      >
                        {Array.from({ length: days }).map((_, d) => (
                          <option key={d} value={d}>
                            Dz {d + 1}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => onRemoveStop(it.id)}
                        className="text-stone-600 hover:text-rose-400"
                        title="Usuń z dnia"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Odcinek do następnego przystanku */}
                  {i < dayItems.length - 1 && (
                    <div className="flex items-center gap-2 px-3 py-1 text-stone-600 text-xs">
                      <div className="w-px h-3 bg-stone-700 ml-2.5" />
                      {routeLoading && !leg ? (
                        <span className="text-stone-600 animate-pulse">liczę trasę…</span>
                      ) : leg ? (
                        <>
                          <Ruler className="w-3 h-3" /> {leg.distanceText}
                          <Clock className="w-3 h-3 ml-1" /> {formatDuration(leg.durationMin)} jazdy
                        </>
                      ) : (
                        <span className="text-stone-700">— brak trasy</span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Analiza dnia (AI + parking) */}
        {dayItems.length > 0 && (
          <div className="mt-3">
            <button
              onClick={onAnalyze}
              disabled={insightLoading}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-gradient-to-r from-forest-700/40 to-water-700/40 border border-water-700/40 text-water-200 text-sm font-medium hover:border-water-500/60 transition-all disabled:opacity-60"
            >
              {insightLoading ? (
                <><RefreshCw className="w-4 h-4 animate-spin" /> Analizuję dzień…</>
              ) : insight ? (
                insightFresh ? <><RefreshCw className="w-4 h-4" /> Odśwież analizę dnia</> : <><RefreshCw className="w-4 h-4" /> Plan się zmienił — przelicz analizę</>
              ) : (
                <><Sparkles className="w-4 h-4" /> Analiza dnia (AI + parking)</>
              )}
            </button>

            {insight && (
              <div className="mt-2 bg-stone-800/50 border border-stone-700/40 rounded-xl p-3 space-y-3">
                {!insightFresh && (
                  <p className="text-amber-400/90 text-xs flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> Analiza dla wcześniejszej wersji dnia — kliknij „przelicz”.
                  </p>
                )}

                {insight.briefing ? (
                  <>
                    {insight.briefing.summary && (
                      <p className="text-stone-200 text-sm leading-relaxed">{insight.briefing.summary}</p>
                    )}
                    {insight.briefing.timing && (
                      <p className="text-stone-300 text-xs flex gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-water-400 flex-shrink-0 mt-0.5" /> <span>{insight.briefing.timing}</span>
                      </p>
                    )}
                    {insight.briefing.feasibility && (
                      <p className="text-stone-300 text-xs flex gap-1.5">
                        <Lightbulb className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" /> <span>{insight.briefing.feasibility}</span>
                      </p>
                    )}
                    {insight.briefing.weather && (
                      <p className="text-stone-400 text-xs">🌦️ {insight.briefing.weather}</p>
                    )}

                    {/* Per przystanek: tip + parking */}
                    {insight.briefing.stops.length > 0 && (
                      <div className="space-y-2 pt-1 border-t border-stone-700/40">
                        {insight.briefing.stops.map((s, i) => {
                          const gp = insight.parking[i]?.spots || []
                          return (
                            <div key={i} className="text-xs">
                              <p className="text-stone-200 font-medium">{i + 1}. {s.name}</p>
                              {s.tip && <p className="text-stone-400 mt-0.5">{s.tip}</p>}
                              {s.parking && (
                                <p className="text-stone-300 mt-0.5 flex gap-1.5">
                                  <Car className="w-3.5 h-3.5 text-forest-400 flex-shrink-0 mt-0.5" /> <span>{s.parking}</span>
                                </p>
                              )}
                              {gp.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {gp.map((p, j) => (
                                    <span key={j} className="text-[11px] bg-stone-900/60 border border-stone-700/40 rounded-full px-2 py-0.5 text-stone-400">
                                      🅿️ {p.name}{p.distanceM != null ? ` · ${p.distanceM} m` : ''}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-stone-400 text-xs">AI chwilowo niedostępne — poniżej same znalezione parkingi.</p>
                )}

                {/* Gdy brak briefu AI, pokaż przynajmniej parkingi z Google */}
                {!insight.briefing && insight.parking.some((p) => p.spots.length > 0) && (
                  <div className="space-y-1.5">
                    {insight.parking.map((p, i) => p.spots.length > 0 && (
                      <div key={i} className="text-xs">
                        <p className="text-stone-300">{p.stop}</p>
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {p.spots.map((s, j) => (
                            <span key={j} className="text-[11px] bg-stone-900/60 border border-stone-700/40 rounded-full px-2 py-0.5 text-stone-400">
                              🅿️ {s.name}{s.distanceM != null ? ` · ${s.distanceM} m` : ''}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Dodawanie miejsc */}
        <button
          onClick={() => setPicker((v) => !v)}
          className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-stone-800/40 border border-dashed border-stone-700/40 text-stone-300 text-sm hover:border-forest-700/50 transition-all"
        >
          <Plus className="w-4 h-4" /> Dodaj miejsce do dnia
        </button>

        {picker && (
          <div className="mt-2 bg-stone-800/60 border border-stone-700/40 rounded-xl p-2">
            <div className="flex items-center justify-between px-1 pb-1.5">
              <p className="text-xs text-stone-400 font-semibold uppercase tracking-wider">Zapisane miejsca</p>
              <button onClick={() => setPicker(false)} className="text-stone-500 hover:text-stone-300">
                <X className="w-4 h-4" />
              </button>
            </div>
            {addable.length === 0 ? (
              <p className="text-stone-600 text-xs px-1 py-2">
                Brak miejsc do dodania. Zapisz miejsca w zakładce „Miejsca” (z lokalizacją), a pojawią się tutaj.
              </p>
            ) : (
              <div className="space-y-1 max-h-56 overflow-y-auto">
                {addable.map((sp) => (
                  <button
                    key={sp.id}
                    onClick={() => { onAddStop(savedToStop(sp)); setPicker(false) }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-stone-900/50 border border-stone-700/30 text-left hover:border-water-700/40 transition-all"
                  >
                    <MapPin className="w-4 h-4 text-water-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-stone-200 text-xs font-medium truncate">{sp.place_name}</p>
                      <p className="text-stone-500 text-[11px] truncate">
                        {((sp.tags as string[]) || []).map((t) => ACTIVITY_TAGS[t] || t).join(' · ') || 'Zapisane miejsce'}
                      </p>
                    </div>
                    <Plus className="w-4 h-4 text-stone-500 flex-shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Polecajki w okolicy dnia (auto w tle) */}
        {dayItems.length > 0 && (nearbyLoading || nearby.length > 0) && (
          <div className="mt-3">
            <p className="text-xs text-water-400 font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" /> W okolicy mogłoby się spodobać
            </p>
            {nearbyLoading && nearby.length === 0 ? (
              <div className="space-y-1.5">
                {[0, 1, 2].map((i) => <div key={i} className="h-12 bg-stone-800/40 rounded-xl animate-pulse" />)}
              </div>
            ) : (
              <div className="space-y-1.5">
                {nearby.map((r) => (
                  <div key={r.googlePlaceId} className="flex items-center gap-2.5 bg-stone-800/40 border border-stone-700/30 rounded-xl px-3 py-2">
                    <MapPin className="w-4 h-4 text-water-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-stone-200 text-xs font-medium truncate">{r.name}</p>
                      <p className="text-stone-500 text-[11px] truncate">
                        {r.googleRating ? `⭐ ${r.googleRating}` : ''}
                        {r.googleRating && (r.tags?.length || r.distanceFromBase != null) ? ' · ' : ''}
                        {(r.tags || []).slice(0, 3).map((t) => ACTIVITY_TAGS[t] || t).join(' · ')}
                        {r.distanceFromBase != null ? `${r.tags?.length ? ' · ' : ''}${r.distanceFromBase} km` : ''}
                      </p>
                    </div>
                    <button
                      onClick={() => onAddNearby(r)}
                      className="text-water-400 hover:text-water-300 flex-shrink-0"
                      title="Dodaj do dnia"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Podpowiedź pogodowa */}
        {weather && weatherHint(weather) && (
          <p className="mt-2 text-xs text-stone-400 bg-stone-800/40 border border-stone-700/30 rounded-xl px-3 py-2">
            {weatherHint(weather)}
          </p>
        )}
      </div>
    </div>
  )
}
