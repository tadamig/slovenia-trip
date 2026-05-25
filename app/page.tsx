'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { generateRoomCode, setSessionName, getSessionName, getRoomHistory, removeRoomFromHistory, RoomHistory } from '@/lib/session'
import { MapPin, Users, Compass, ArrowRight, Loader2, Clock, X } from 'lucide-react'

export default function LandingPage() {
  const router = useRouter()
  const [mode, setMode] = useState<'home' | 'create' | 'join'>('home')
  const [roomCode, setRoomCode] = useState('')
  const [userName, setUserName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [history, setHistory] = useState<RoomHistory[]>([])

  useEffect(() => {
    setUserName(getSessionName() !== 'Nieznajomy' ? getSessionName() : '')
    setHistory(getRoomHistory())
  }, [])

  async function handleCreate() {
    if (!userName.trim()) { setError('Podaj swoje imię'); return }
    setLoading(true)
    setError('')
    try {
      const code = generateRoomCode()
      const { error: dbError } = await supabase.from('rooms').insert({
        code,
        trip_name: 'Wyprawa 🏔️',
      })
      if (dbError) throw dbError
      setSessionName(userName.trim())
      router.push(`/room/${code}`)
    } catch {
      setError('Nie udało się utworzyć pokoju. Sprawdź połączenie.')
      setLoading(false)
    }
  }

  async function handleJoin() {
    if (!userName.trim()) { setError('Podaj swoje imię'); return }
    if (!roomCode.trim()) { setError('Podaj kod pokoju'); return }
    setLoading(true)
    setError('')
    try {
      const { data, error: dbError } = await supabase
        .from('rooms').select('code').eq('code', roomCode.toUpperCase().trim()).single()
      if (dbError || !data) { setError('Nie znaleziono pokoju. Sprawdź kod.'); setLoading(false); return }
      setSessionName(userName.trim())
      router.push(`/room/${roomCode.toUpperCase().trim()}`)
    } catch {
      setError('Błąd połączenia.')
      setLoading(false)
    }
  }

  function handleRemoveHistory(code: string, e: React.MouseEvent) {
    e.stopPropagation()
    removeRoomFromHistory(code)
    setHistory(getRoomHistory())
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  return (
    <main className="min-h-screen flex flex-col relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-stone-950 via-forest-900/30 to-water-900/20" />
      <div className="absolute top-0 right-0 w-96 h-96 bg-forest-500/5 rounded-full blur-3xl" />
      <div className="absolute bottom-0 left-0 w-96 h-96 bg-water-500/5 rounded-full blur-3xl" />

      <div className="relative z-10 flex flex-col min-h-screen px-4">
        {/* Header */}
        <header className="pt-12 pb-6 text-center animate-fade-up">
          <div className="inline-flex items-center gap-2 bg-forest-500/10 border border-forest-500/20 rounded-full px-4 py-1.5 mb-6">
            <Compass className="w-3.5 h-3.5 text-forest-400" />
            <span className="text-forest-400 text-xs font-medium tracking-wider uppercase">Planer wyprawy</span>
          </div>
          <h1 className="font-display text-4xl md:text-5xl font-bold text-stone-50 leading-tight mb-3">
            Słowenia<br />
            <span className="text-forest-400">& Budapeszt</span>
          </h1>
          <p className="text-stone-400 text-sm max-w-xs mx-auto leading-relaxed">
            Planuj razem z ekipą w czasie rzeczywistym — SUP, trekking, lokalne smaki i zachody słońca.
          </p>
        </header>

        <div className="flex-1 flex flex-col items-center">
          <div className="w-full max-w-sm space-y-3">

            {/* Historia pokojów */}
            {mode === 'home' && history.length > 0 && (
              <div className="mb-2 animate-fade-up">
                <p className="text-xs text-stone-500 font-semibold uppercase tracking-wider mb-2 px-1">
                  🕐 Twoje wyprawy
                </p>
                <div className="space-y-2">
                  {history.map(room => (
                    <button
                      key={room.code}
                      onClick={() => router.push(`/room/${room.code}`)}
                      className="w-full flex items-center gap-3 bg-stone-800/60 hover:bg-stone-800 border border-stone-700/50 hover:border-forest-600/50 rounded-2xl px-4 py-3.5 transition-all group text-left"
                    >
                      <div className="w-10 h-10 rounded-xl bg-forest-800/40 border border-forest-700/30 flex items-center justify-center flex-shrink-0">
                        <span className="text-lg">🏔️</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-stone-100 text-sm font-semibold truncate">{room.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="font-mono text-xs text-forest-400 bg-forest-900/40 px-1.5 py-0.5 rounded">{room.code}</span>
                          <span className="text-stone-600 text-xs flex items-center gap-1">
                            <Clock className="w-3 h-3" />{formatDate(room.joinedAt)}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <ArrowRight className="w-4 h-4 text-stone-600 group-hover:text-forest-400 group-hover:translate-x-0.5 transition-all" />
                        <button
                          onClick={e => handleRemoveHistory(room.code, e)}
                          className="p-1 text-stone-700 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="h-px bg-stone-800 my-4" />
              </div>
            )}

            {/* Główne przyciski */}
            {mode === 'home' && (
              <div className="space-y-3 animate-fade-up">
                <button
                  onClick={() => setMode('create')}
                  className="w-full bg-forest-600 hover:bg-forest-500 text-white rounded-2xl p-5 flex items-center justify-between group transition-all duration-200 active:scale-95"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-forest-500/30 rounded-xl flex items-center justify-center">
                      <MapPin className="w-5 h-5 text-forest-200" />
                    </div>
                    <div className="text-left">
                      <div className="font-semibold text-sm">Utwórz pokój</div>
                      <div className="text-forest-300 text-xs mt-0.5">Generuj kod dla ekipy</div>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-forest-300 group-hover:translate-x-1 transition-transform" />
                </button>

                <button
                  onClick={() => setMode('join')}
                  className="w-full bg-stone-800 hover:bg-stone-700 border border-stone-700 text-white rounded-2xl p-5 flex items-center justify-between group transition-all duration-200 active:scale-95"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-stone-700/50 rounded-xl flex items-center justify-center">
                      <Users className="w-5 h-5 text-stone-300" />
                    </div>
                    <div className="text-left">
                      <div className="font-semibold text-sm">Dołącz do pokoju</div>
                      <div className="text-stone-500 text-xs mt-0.5">Masz już kod od znajomych</div>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-stone-500 group-hover:translate-x-1 transition-transform" />
                </button>

                <div className="grid grid-cols-3 gap-2 mt-4">
                  {[{ icon: '🔄', label: 'Sync real-time' }, { icon: '🗺️', label: 'Mapa trasy' }, { icon: '🌤️', label: 'Pogoda' }].map(f => (
                    <div key={f.label} className="bg-stone-800/40 rounded-xl p-3 text-center">
                      <div className="text-2xl mb-1">{f.icon}</div>
                      <div className="text-stone-500 text-xs">{f.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Create / Join form */}
            {(mode === 'create' || mode === 'join') && (
              <div className="bg-stone-900 border border-stone-800 rounded-2xl p-6 space-y-4 animate-fade-up">
                <button onClick={() => { setMode('home'); setError('') }} className="text-stone-500 hover:text-stone-300 text-xs flex items-center gap-1 transition-colors">
                  ← Wróć
                </button>
                <h2 className="font-display text-xl font-semibold text-stone-50">
                  {mode === 'create' ? 'Nowa wyprawa' : 'Dołącz do ekipy'}
                </h2>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-stone-500 font-medium block mb-1.5">Twoje imię</label>
                    <input
                      type="text"
                      value={userName}
                      onChange={e => setUserName(e.target.value)}
                      placeholder="np. Kasia"
                      className="w-full bg-stone-800 border border-stone-700 rounded-xl px-4 py-3 text-sm text-stone-100 placeholder-stone-600 focus:outline-none focus:border-forest-500 transition-colors"
                      maxLength={20}
                    />
                  </div>
                  {mode === 'join' && (
                    <div>
                      <label className="text-xs text-stone-500 font-medium block mb-1.5">Kod pokoju</label>
                      <input
                        type="text"
                        value={roomCode}
                        onChange={e => setRoomCode(e.target.value.toUpperCase())}
                        placeholder="np. XK7P2Q"
                        className="w-full bg-stone-800 border border-stone-700 rounded-xl px-4 py-3 text-sm text-stone-100 placeholder-stone-600 focus:outline-none focus:border-water-500 transition-colors font-mono tracking-widest uppercase"
                        maxLength={6}
                      />
                    </div>
                  )}
                  {error && <p className="text-red-400 text-xs bg-red-400/10 rounded-lg px-3 py-2">{error}</p>}
                  <button
                    onClick={mode === 'create' ? handleCreate : handleJoin}
                    disabled={loading}
                    className="w-full bg-forest-600 hover:bg-forest-500 disabled:bg-stone-700 disabled:text-stone-500 text-white rounded-xl py-3.5 text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-200 active:scale-95"
                  >
                    {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Łączę...</> : mode === 'create' ? <><MapPin className="w-4 h-4" /> Stwórz pokój</> : <><Users className="w-4 h-4" /> Dołącz</>}
                  </button>
                </div>
                <p className="text-stone-600 text-xs text-center">Bez rejestracji. Dostęp tylko przez kod pokoju.</p>
              </div>
            )}
          </div>
        </div>

        <footer className="py-6 text-center text-stone-700 text-xs">
          🚐 10 dni · 4 osoby · deski SUP · zachody słońca
        </footer>
      </div>
    </main>
  )
}
