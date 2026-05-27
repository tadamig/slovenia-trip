'use client'

import { useState } from 'react'
import { Room } from '@/lib/supabase'
import { Copy, Check, Users } from 'lucide-react'

interface Props {
  room: Room
  memberCount: number
}

export default function RoomHeader({ room, memberCount }: Props) {
  const [copied, setCopied] = useState(false)

  function copyCode() {
    navigator.clipboard.writeText(room.code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <header className="bg-stone-900/80 backdrop-blur-sm border-b border-stone-800 px-4 py-3 sticky top-0 z-40">
      <div className="flex items-center justify-between max-w-lg mx-auto">
        <div>
          <h1 className="font-display text-base font-semibold text-stone-100 leading-tight">
            {room.trip_name}
          </h1>
          {(room.start_city || room.end_city) && (
            <p className="text-stone-500 text-xs mt-0.5">
              {[room.start_city, room.end_city].filter(Boolean).join(' → ')}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-stone-500 text-xs">
            <Users className="w-3.5 h-3.5" />
            <span>{memberCount}</span>
          </div>

          <button
            onClick={copyCode}
            className="flex items-center gap-1.5 bg-stone-800 hover:bg-stone-700 border border-stone-700 rounded-lg px-2.5 py-1.5 transition-all"
          >
            {copied ? (
              <><Check className="w-3 h-3 text-forest-400" /><span className="text-forest-400 text-xs font-mono">Skopiowano</span></>
            ) : (
              <><Copy className="w-3 h-3 text-stone-400" /><span className="text-stone-400 text-xs font-mono">{room.code}</span></>
            )}
          </button>
        </div>
      </div>
    </header>
  )
}
