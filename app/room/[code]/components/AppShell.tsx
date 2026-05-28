'use client'

import { useState } from 'react'
import { Room, UserPreference } from '@/lib/supabase'
import { Map, CheckSquare, CloudSun, MessageSquare, BookMarked, Settings } from 'lucide-react'
import RoomHeader from './RoomHeader'
import PackingList from './PackingList'
import GroupProfile from './GroupProfile'

// Lazy-loaded tabs (będą dodane w kolejnych modułach)
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

      {/* Content */}
      <div className="flex-1 overflow-y-auto pb-20">
        {activeTab === 'profile' && (
          <GroupProfile
            room={room}
            myPrefs={myPrefs}
            allPrefs={allPrefs}
            onReloadPrefs={onReloadPrefs}
          />
        )}
        {activeTab === 'packing' && (
          <PackingList room={room} myPrefs={myPrefs} />
        )}
        {activeTab === 'weather' && (
          <PlaceholderTab emoji="🌤️" label="Widget Pogody" description="Open-Meteo API — prognoza dla Budapesztu i Słowenii" module="M3" />
        )}
        {activeTab === 'places' && (
          <PlaceholderTab emoji="📍" label="Rekomendacje Miejsc" description="Reddit scraper + walidacja źródeł (≥3)" module="M4+M5" />
        )}
        {activeTab === 'map' && (
          <PlaceholderTab emoji="🗺️" label="Mapa Trasy" description="Leaflet.js + OpenStreetMap — trasa, pinezki, odległości" module="M6" />
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
                activeTab === tab.id
                  ? 'text-forest-400'
                  : 'text-stone-600 hover:text-stone-400'
              }`}
            >
              <span className="text-lg leading-none">{tab.icon}</span>
              <span className="text-[10px] font-medium truncate">{tab.label}</span>
              {activeTab === tab.id && (
                <div className="w-1 h-1 bg-forest-400 rounded-full" />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function PlaceholderTab({ emoji, label, description, module: mod }: {
  emoji: string; label: string; description: string; module: string
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <div className="text-6xl mb-4 animate-pulse-soft">{emoji}</div>
      <h3 className="font-display text-xl font-semibold text-stone-200 mb-2">{label}</h3>
      <p className="text-stone-500 text-sm mb-4 leading-relaxed">{description}</p>
      <span className="bg-stone-800 border border-stone-700 text-stone-500 text-xs px-3 py-1.5 rounded-full font-mono">
        {mod} — w budowie
      </span>
    </div>
  )
}
