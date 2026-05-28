'use client'

import { useState } from 'react'
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
}

export default function AppShell({ room, myPrefs, allPrefs, onReloadPrefs }: Props) {
  const [activeTab, setActiveTab] = useState('profile')

  return (
    <div className="min-h-screen bg-stone-950 flex flex-col">
      <RoomHeader room={room} memberCount={allPrefs.length} />

      <div className="flex-1 overflow-y-auto pb-20">
        {activeTab === 'profile' && (
          <GroupProfile room={room} myPrefs={myPrefs} allPrefs={allPrefs} onReloadPrefs={onReloadPrefs} />
        )}
        {activeTab === 'packing' && (
          <PackingList room={room} myPrefs={myPrefs} allPrefs={allPrefs} />
        )}
        {activeTab === 'weather' && (
          <WeatherWidget room={room} myPrefs={myPrefs} />
        )}
        {activeTab === 'places' && (
          <PlacesTab room={room} myPrefs={myPrefs} allPrefs={allPrefs} />
        )}
        {activeTab === 'map' && (
          <MapTab room={room} myPrefs={myPrefs} />
        )}
      </div>

      {/* Bottom tab bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-stone-900/95 backdrop-blur-sm border-t border-stone-800 px-2 py-2 z-50">
        <div className="flex justify-around max-w-lg mx-auto">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-all duration-150 min-w-0 ${
                activeTab === tab.id ? 'text-forest-400' : 'text-stone-600 hover:text-stone-400'
              }`}
            >
              <span className="text-lg leading-none">{tab.icon}</span>
              <span className="text-[10px] font-medium truncate">{tab.label}</span>
              {activeTab === tab.id && <div className="w-1 h-1 bg-forest-400 rounded-full" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
