'use client'

import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { Room, UserPreference } from '@/lib/supabase'
import dynamic from 'next/dynamic'
import RoomHeader from './RoomHeader'
import PackingList from './PackingList'
import GroupProfile from './GroupProfile'
import WeatherWidget from './WeatherWidget'
import PlacesTab from './PlacesTab'
import { GUIDE_ENABLED } from '@/lib/featureFlags'

// Przewodnik (opcjonalny dodatek z PDF) — ładowany dynamicznie (geolokalizacja).
const GuideTab = dynamic(() => import('./GuideTab'), { ssr: false })

// Mapa ładowana dynamicznie (wymaga window/browser)
const MapTab = dynamic(() => import('./MapTab'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center">
        <div className="text-5xl mb-4 animate-pulse">🗺️</div>
        <p className="text-stone-500 text-sm">Ładowanie mapy...</p>
      </div>
    </div>
  ),
})

const TABS = [
  { id: 'profile', label: 'Ekipa', icon: '👥' },
  { id: 'packing', label: 'Pakowanie', icon: '🎒' },
  { id: 'weather', label: 'Pogoda', icon: '🌤️' },
  { id: 'places', label: 'Miejsca', icon: '📍' },
  { id: 'map', label: 'Mapa', icon: '🗺️' },
  ...(GUIDE_ENABLED ? [{ id: 'guide', label: 'Przewodnik', icon: '📖' }] : []),
]

interface Props {
  room: Room
  myPrefs: UserPreference
  allPrefs: UserPreference[]
  onReloadPrefs: () => void
  prefetched?: { places: any[]; baseLat: number | null; baseLon: number | null } | null
}

const TAB_IDS = TABS.map(t => t.id)

// useLayoutEffect odpala się PRZED malowaniem klatki (bez migania), ale ostrzega
// przy SSR — na serwerze spadamy więc do useEffect. Wybór raz, na poziomie modułu.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

export default function AppShell({ room, myPrefs, allPrefs, onReloadPrefs, prefetched }: Props) {
  // Po onboardingu (Tor B) startujemy od zakładki Miejsca — tam czekają wyniki.
  const initialTab = prefetched ? 'places' : 'profile'
  const [activeTab, setActiveTab] = useState(initialTab)
  // Kierunek wsuwania panelu zależny od kolejności zakładek (dalej = z prawej).
  const [slideDir, setSlideDir] = useState<'left' | 'right'>('right')
  // Zakładki montujemy leniwie (przy 1. wejściu) i potem TRZYMAMY zamontowane —
  // dzięki temu nie pobierają danych od nowa i nie migają przy przełączaniu.
  const [visited, setVisited] = useState<Record<string, boolean>>({ [initialTab]: true })

  const scrollRef = useRef<HTMLDivElement>(null)
  const panelRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const goToTab = (id: string) => {
    if (id === activeTab) return
    const from = TAB_IDS.indexOf(activeTab)
    const to = TAB_IDS.indexOf(id)
    setSlideDir(to > from ? 'right' : 'left')
    setVisited(v => (v[id] ? v : { ...v, [id]: true }))
    setActiveTab(id)
  }

  // Wszystkie panele są zamontowane (chowane CSS-em). Animację wsuwania odpalamy
  // ręcznie na aktywnym panelu PRZED malowaniem (useLayoutEffect) — brak migania.
  useIsoLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    const el = panelRefs.current[activeTab]
    if (el) {
      el.classList.remove('tab-slide-left', 'tab-slide-right')
      void el.offsetWidth // wymuś reflow, by animacja odpaliła ponownie
      el.classList.add(slideDir === 'right' ? 'tab-slide-right' : 'tab-slide-left')
    }
  }, [activeTab, slideDir])

  const setPanelRef = (id: string) => (el: HTMLDivElement | null) => { panelRefs.current[id] = el }
  const panelStyle = (id: string) => ({ display: activeTab === id ? 'block' : ('none' as const) })

  return (
    <div className="min-h-screen bg-stone-950 flex flex-col">
      <RoomHeader room={room} memberCount={allPrefs.length} />

      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden pb-28">
        <div className="max-w-md mx-auto w-full">
          <div ref={setPanelRef('profile')} style={panelStyle('profile')}>
            {visited.profile && (
              <GroupProfile room={room} myPrefs={myPrefs} allPrefs={allPrefs} onReloadPrefs={onReloadPrefs} />
            )}
          </div>
          <div ref={setPanelRef('packing')} style={panelStyle('packing')}>
            {visited.packing && (
              <PackingList
                room={room}
                myPrefs={myPrefs}
                allPrefs={allPrefs}
                onScrollTop={() => {
                  // Kontener (gdy to on przewija) ORAZ okno (gdy przy min-h-screen
                  // przewija się cały dokument) — w obu wariantach lecimy na górę.
                  scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                }}
              />
            )}
          </div>
          <div ref={setPanelRef('weather')} style={panelStyle('weather')}>
            {visited.weather && (
              <WeatherWidget room={room} myPrefs={myPrefs} />
            )}
          </div>
          {/* PlacesTab trzymamy zamontowany na stałe, żeby analiza AI i prefetch
              nie ginęły przy przełączaniu zakładek i nie liczyły się od nowa. */}
          <div ref={setPanelRef('places')} style={panelStyle('places')}>
            <PlacesTab room={room} myPrefs={myPrefs} allPrefs={allPrefs} prefetched={prefetched} />
          </div>
          <div ref={setPanelRef('map')} style={panelStyle('map')}>
            {visited.map && (
              <MapTab room={room} myPrefs={myPrefs} />
            )}
          </div>
          {GUIDE_ENABLED && (
            <div ref={setPanelRef('guide')} style={panelStyle('guide')}>
              {visited.guide && <GuideTab />}
            </div>
          )}
        </div>
      </div>

      {/* Pływający pasek-pigułka — liquid glass + kolorowa poświata */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-3 w-full max-w-md flex justify-center">
        <div className="relative">
          {/* subtelna poświata pod paskiem (forest → water) */}
          <div
            aria-hidden
            className="absolute -inset-1 rounded-full bg-gradient-to-r from-forest-400/20 via-water-400/15 to-water-300/20 blur-lg opacity-50 pointer-events-none"
          />
          {/* szklany pasek */}
          <div className="relative flex items-center justify-center gap-1 rounded-full px-2 py-1.5 bg-stone-900/40 backdrop-blur-2xl border border-white/15 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
            {/* górne światło (glass highlight) */}
            <div
              aria-hidden
              className="absolute inset-x-3 top-0 h-1/2 rounded-full bg-gradient-to-b from-white/15 to-transparent pointer-events-none z-0"
            />
            {TABS.map(tab => {
              const active = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => goToTab(tab.id)}
                  className={`relative z-10 flex flex-col items-center justify-center gap-0.5 rounded-full transition-all duration-300 min-w-0 ${
                    active
                      ? 'bg-gradient-to-br from-forest-500/80 to-water-500/80 text-white px-3.5 py-1.5 border border-white/20 shadow-[0_0_9px_rgba(44,196,255,0.28)]'
                      : 'text-stone-400 hover:text-white px-2.5 py-1.5'
                  }`}
                >
                  <span className="text-lg leading-none">{tab.icon}</span>
                  <span className="text-[10px] font-medium leading-none truncate">{tab.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
