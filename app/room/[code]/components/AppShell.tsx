'use client'

import { useState, useEffect, useRef } from 'react'
import { Room, UserPreference } from '@/lib/supabase'
import dynamic from 'next/dynamic'
import RoomHeader from './RoomHeader'
import PackingList from './PackingList'
import GroupProfile from './GroupProfile'
import WeatherWidget from './WeatherWidget'
import PlacesTab from './PlacesTab'

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
]

interface Props {
  room: Room
  myPrefs: UserPreference
  allPrefs: UserPreference[]
  onReloadPrefs: () => void
  prefetched?: { places: any[]; baseLat: number | null; baseLon: number | null } | null
}

const TAB_IDS = TABS.map(t => t.id)

export default function AppShell({ room, myPrefs, allPrefs, onReloadPrefs, prefetched }: Props) {
  // Po onboardingu (Tor B) startujemy od zakładki Miejsca — tam czekają wyniki.
  const [activeTab, setActiveTab] = useState(prefetched ? 'places' : 'profile')
  // Kierunek wsuwania panelu zależny od kolejności zakładek (dalej = z prawej).
  const [slideDir, setSlideDir] = useState<'left' | 'right'>('right')
  const placesRef = useRef<HTMLDivElement>(null)

  const goToTab = (id: string) => {
    if (id === activeTab) return
    const from = TAB_IDS.indexOf(activeTab)
    const to = TAB_IDS.indexOf(id)
    setSlideDir(to > from ? 'right' : 'left')
    setActiveTab(id)
  }

  // PlacesTab jest zamontowany na stałe (chowany CSS-em), więc nie remontuje się
  // przy przełączaniu — animację wsuwania odpalamy ręcznie przez retrigger CSS.
  useEffect(() => {
    if (activeTab === 'places' && placesRef.current) {
      const el = placesRef.current
      el.classList.remove('tab-slide-left', 'tab-slide-right')
      // wymuś reflow, żeby animacja odpaliła ponownie
      void el.offsetWidth
      el.classList.add(slideDir === 'right' ? 'tab-slide-right' : 'tab-slide-left')
    }
  }, [activeTab, slideDir])

  const slideClass = slideDir === 'right' ? 'tab-slide-right' : 'tab-slide-left'

  return (
    <div className="min-h-screen bg-stone-950 flex flex-col">
      <RoomHeader room={room} memberCount={allPrefs.length} />

      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-28">
        <div className="max-w-md mx-auto w-full">
          {/* PlacesTab trzymamy zamontowany na stałe (chowamy CSS-em), żeby analiza AI
              i prefetch nie ginęły przy przełączaniu zakładek i nie liczyły się od nowa. */}
          <div style={{ display: activeTab === 'places' ? 'block' : 'none' }}>
            <div ref={placesRef}>
              <PlacesTab room={room} myPrefs={myPrefs} allPrefs={allPrefs} prefetched={prefetched} />
            </div>
          </div>

          {/* Pozostałe zakładki: keyed wrapper -> animacja wsuwania przy każdej zmianie. */}
          {activeTab !== 'places' && (
            <div key={activeTab} className={slideClass}>
              {activeTab === 'profile' && (
                <GroupProfile room={room} myPrefs={myPrefs} allPrefs={allPrefs} onReloadPrefs={onReloadPrefs} />
              )}
              {activeTab === 'packing' && (
                <PackingList room={room} myPrefs={myPrefs} allPrefs={allPrefs} />
              )}
              {activeTab === 'weather' && (
                <WeatherWidget room={room} myPrefs={myPrefs} />
              )}
              {activeTab === 'map' && (
                <MapTab room={room} myPrefs={myPrefs} />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Pływający pasek-pigułka */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-3 w-full max-w-md">
        <div className="flex items-center justify-between gap-1 mx-auto bg-stone-900/85 backdrop-blur-md border border-stone-700/50 rounded-full px-2 py-1.5 shadow-lg shadow-black/50">
          {TABS.map(tab => {
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => goToTab(tab.id)}
                className={`flex flex-col items-center justify-center gap-0.5 rounded-full transition-all duration-200 min-w-0 ${
                  active
                    ? 'bg-forest-500 text-white px-3.5 py-1.5 shadow-md shadow-forest-900/40'
                    : 'text-stone-500 hover:text-stone-300 px-2.5 py-1.5'
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
  )
}
