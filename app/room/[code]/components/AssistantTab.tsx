'use client'

// Asystent AI (opcjonalny dodatek). Wspólny czat pokoju: pytania o Słowenię i
// miejsca z poradnika + plan dnia z przyciskiem „Wrzuć do planera".
// Usuwalny: skasuj ten plik + /api/assistant + wpis w AppShell + DROP TABLE assistant_messages.

import { useEffect, useMemo, useRef, useState } from 'react'
import { setOptions, importLibrary } from '@googlemaps/js-api-loader'
import { supabase, Room, AssistantMessage, AssistantPlan, AssistantPlanStop } from '@/lib/supabase'
import { getSessionId, getSessionName } from '@/lib/session'
import { useItinerary } from './useItinerary'
import { tripDayCount } from './itineraryUtils'
import GuideDetailModal, { GuideFallback } from './GuideDetailModal'
import { Sparkles, Send, CalendarPlus, Check, Bot, User, ExternalLink, Map as MapIcon, Trash2, Crosshair } from 'lucide-react'

const GMAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || ''
const CATMAP: Record<string, { label: string; emoji: string }> = {
  attraction: { label: 'Atrakcje', emoji: '🏛️' }, restaurant: { label: 'Restauracje', emoji: '🍴' },
  beach: { label: 'Plaże', emoji: '🏖️' }, trail: { label: 'Szlaki', emoji: '🥾' },
  wine: { label: 'Winiarnie', emoji: '🍷' }, camping: { label: 'Campingi', emoji: '⛺' },
  lodging: { label: 'Noclegi', emoji: '🛏️' }, parking: { label: 'Parkingi', emoji: '🅿️' },
}

// Mini-mapa podglądu trasy planu (numerowane przystanki + linia).
function MiniMap({ stops }: { stops: AssistantPlanStop[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const pts = stops.filter((s) => s.lat != null && s.lon != null)
    if (!ref.current || !GMAPS_KEY || !pts.length) return
    let cancel = false
    setOptions({ key: GMAPS_KEY, v: 'weekly' })
    importLibrary('maps').then(({ Map }) => {
      if (cancel || !ref.current) return
      const map = new Map(ref.current, { disableDefaultUI: true, zoomControl: true, gestureHandling: 'greedy' })
      const bounds = new google.maps.LatLngBounds()
      const path: google.maps.LatLngLiteral[] = []
      pts.forEach((s, i) => {
        const pos = { lat: s.lat as number, lng: s.lon as number }
        bounds.extend(pos); path.push(pos)
        new google.maps.Marker({
          position: pos, map, title: s.name,
          label: { text: String(i + 1), color: '#fff', fontSize: '12px', fontWeight: '600' },
          icon: { path: google.maps.SymbolPath.CIRCLE, scale: 12, fillColor: '#3d7f41', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
        })
      })
      new google.maps.Polyline({ path, map, strokeColor: '#2cc4ff', strokeOpacity: 0.85, strokeWeight: 3 })
      if (pts.length > 1) map.fitBounds(bounds, 30); else { map.setCenter(path[0]); map.setZoom(13) }
    }).catch(() => {})
    return () => { cancel = true }
  }, [stops])
  return <div ref={ref} className="w-full h-48 rounded-lg overflow-hidden border border-stone-700/40 mt-2" />
}

const SUGGESTIONS = [
  'Zaplanuj dzień w okolicy Bledu',
  'Co warto zobaczyć nad Soczą?',
  'Gdzie dobrze zjeść w Piranie?',
  'Najlepsze szlaki na pół dnia',
]

// —— mini-render markdown (bez zależności): akapity, listy "- ", "1.", **pogrubienie** ——
function inline(text: string, key: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) =>
    /^\*\*[^*]+\*\*$/.test(p)
      ? <strong key={`${key}-${i}`} className="font-semibold text-stone-100">{p.slice(2, -2)}</strong>
      : <span key={`${key}-${i}`}>{p}</span>,
  )
}
function RichText({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n')
  const blocks: React.ReactNode[] = []
  let list: { type: 'ul' | 'ol'; items: string[] } | null = null
  const flush = (k: string) => {
    if (!list) return
    const items = list.items.map((it, i) => <li key={`${k}-li-${i}`}>{inline(it, `${k}-li-${i}`)}</li>)
    blocks.push(list.type === 'ul'
      ? <ul key={k} className="list-disc pl-5 space-y-0.5 my-1">{items}</ul>
      : <ol key={k} className="list-decimal pl-5 space-y-0.5 my-1">{items}</ol>)
    list = null
  }
  lines.forEach((raw, i) => {
    const line = raw.trimEnd()
    const k = `b${i}`
    const ul = line.match(/^\s*[-*]\s+(.*)$/)
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/)
    const h = line.match(/^#{1,3}\s+(.*)$/)
    if (ul) { if (!list || list.type !== 'ul') { flush(`${k}f`); list = { type: 'ul', items: [] } } list.items.push(ul[1]); return }
    if (ol) { if (!list || list.type !== 'ol') { flush(`${k}f`); list = { type: 'ol', items: [] } } list.items.push(ol[1]); return }
    flush(`${k}f`)
    if (h) { blocks.push(<p key={k} className="font-semibold text-stone-100 mt-1.5">{inline(h[1], k)}</p>); return }
    if (line.trim() === '') return
    blocks.push(<p key={k} className="leading-relaxed">{inline(line, k)}</p>)
  })
  flush('end')
  return <div className="space-y-1 text-sm text-stone-300">{blocks}</div>
}

// Karuzela kart miejsc (jak zdjęcia na IG): zdjęcie + ocena + opis; tap → modal szczegółów.
function PlaceCarousel({ stops, onOpenPlace }: { stops: AssistantPlanStop[]; onOpenPlace: (_s: AssistantPlanStop) => void }) {
  const [info, setInfo] = useState<Record<string, { photo?: string; rating?: number | null; total?: number | null; desc?: string | null; category?: string }>>({})
  useEffect(() => {
    const ids = stops.map((s) => s.guide_place_id).filter(Boolean) as string[]
    if (!ids.length) return
    let cancel = false
    ;(async () => {
      const [{ data: gp }, { data: det }] = await Promise.all([
        supabase.from('guide_places').select('id,category,description,google_rating,google_total_ratings').in('id', ids),
        supabase.from('guide_place_details').select('guide_place_id,photos').in('guide_place_id', ids),
      ])
      if (cancel) return
      const photoById: Record<string, string> = {}
      ;(det || []).forEach((d: any) => { if (Array.isArray(d.photos) && d.photos[0]) photoById[d.guide_place_id] = d.photos[0] })
      const map: any = {}
      ;(gp || []).forEach((p: any) => { map[p.id] = { photo: photoById[p.id], rating: p.google_rating, total: p.google_total_ratings, desc: p.description, category: p.category } })
      setInfo(map)
    })()
    return () => { cancel = true }
  }, [stops])

  return (
    <div className="flex gap-2 overflow-x-auto snap-x snap-mandatory scrollbar-hide -mx-1 px-1 pb-1" style={{ scrollbarWidth: 'none' }}>
      {stops.map((s, i) => {
        const d = s.guide_place_id ? info[s.guide_place_id] : undefined
        const emoji = CATMAP[d?.category || '']?.emoji || '📍'
        return (
          <button key={i} onClick={() => onOpenPlace(s)} className="snap-start shrink-0 w-40 rounded-xl overflow-hidden border border-stone-700/40 bg-stone-800/60 text-left hover:border-forest-700/60 transition-colors">
            <div className="h-24 bg-stone-900 relative">
              {d?.photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/guide-photo?ref=${encodeURIComponent(d.photo)}&w=400`} alt={s.name} loading="lazy" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-2xl">{emoji}</div>
              )}
              <span className="absolute top-1 left-1 w-5 h-5 rounded-full bg-forest-600 text-white text-[10px] flex items-center justify-center font-semibold shadow">{i + 1}</span>
              {s.drive_min_from_prev ? <span className="absolute top-1 right-1 bg-black/60 text-white text-[9px] px-1.5 py-0.5 rounded-full">🚗 {s.drive_min_from_prev}′</span> : null}
            </div>
            <div className="p-2">
              <p className="text-stone-100 text-xs font-medium line-clamp-1">{s.name}</p>
              <div className="flex items-center gap-1.5 text-[10px] text-stone-500 mt-0.5">
                <span>{emoji}</span>
                {d?.rating ? <span className="text-amber-400 inline-flex items-center gap-0.5">★ {d.rating}{d.total ? ` (${d.total})` : ''}</span> : null}
                {s.duration_min ? <span>· ~{s.duration_min} min</span> : null}
              </div>
              {(d?.desc || s.note) ? <p className="text-[10px] text-stone-400 line-clamp-2 mt-0.5 leading-snug">{d?.desc || s.note}</p> : null}
              <span className="text-[10px] text-water-400 mt-1 inline-block">Szczegóły →</span>
            </div>
          </button>
        )
      })}
    </div>
  )
}

function PlanBlock({ plan, room, addStops, maxDayIndex, onOpenPlace }: {
  plan: AssistantPlan
  room: Room
  addStops: (_dayIndex: number, _stops: any[]) => Promise<void>
  maxDayIndex: number
  onOpenPlace: (_s: AssistantPlanStop) => void
}) {
  const days = Math.max(1, tripDayCount(room, maxDayIndex, 0))
  const [day, setDay] = useState(1)
  const [state, setState] = useState<'idle' | 'adding' | 'done'>('idle')
  const [showMap, setShowMap] = useState(false)

  const add = async () => {
    if (state === 'adding') return
    setState('adding')
    await addStops(day - 1, plan.stops.map((s) => ({
      place_name: s.name,
      place_id: s.place_id ?? null,
      lat: s.lat ?? null,
      lon: s.lon ?? null,
      duration_min: s.duration_min ?? null,
    })))
    setState('done')
  }

  return (
    <div className="mt-2 rounded-xl border border-forest-800/40 bg-forest-900/15 p-3">
      {plan.title && <p className="text-forest-300 text-xs font-semibold mb-1.5">🗺️ {plan.title}</p>}
      <PlaceCarousel stops={plan.stops} onOpenPlace={onOpenPlace} />

      {plan.stops.some((s) => s.lat != null) && (
        <button onClick={() => setShowMap((v) => !v)} className="mt-2 text-[11px] text-water-400 hover:text-water-300 inline-flex items-center gap-1">
          <MapIcon className="w-3.5 h-3.5" /> {showMap ? 'Ukryj mapę' : 'Pokaż na mapie'}
        </button>
      )}
      {showMap && <MiniMap stops={plan.stops} />}
      <div className="flex items-center gap-2 mt-2.5">
        {state === 'done' ? (
          <span className="text-emerald-400 text-xs flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Dodano do Dnia {day}</span>
        ) : (
          <>
            <label className="text-[11px] text-stone-500">Dzień</label>
            <select
              value={day}
              onChange={(e) => setDay(Number(e.target.value))}
              className="bg-stone-800 border border-stone-700 rounded-lg text-xs text-stone-200 px-2 py-1 focus:outline-none"
            >
              {Array.from({ length: days }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <button
              onClick={add}
              disabled={state === 'adding'}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-forest-600 hover:bg-forest-500 text-white text-xs font-medium disabled:opacity-60"
            >
              <CalendarPlus className="w-3.5 h-3.5" /> {state === 'adding' ? 'Dodaję…' : 'Wrzuć do planera'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default function AssistantTab({ room }: { room: Room }) {
  const sessionId = typeof window !== 'undefined' ? getSessionId() : ''
  const myName = (typeof window !== 'undefined' ? getSessionName() : '') || 'Ktoś'
  const { items, addStops } = useItinerary(room.id, sessionId)
  const maxDayIndex = useMemo(() => items.reduce((m, it) => Math.max(m, it.day_index), 0), [items])

  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [steps, setSteps] = useState<{ icon: string; label: string }[]>([])
  const [liveReply, setLiveReply] = useState('')
  const [userPos, setUserPos] = useState<{ lat: number; lon: number } | null>(null)
  const [geo, setGeo] = useState<'idle' | 'loading' | 'on' | 'denied'>('idle')
  const [detailPlace, setDetailPlace] = useState<GuideFallback | null>(null)

  const askLocation = () => {
    if (!navigator.geolocation) { setGeo('denied'); return }
    setGeo('loading')
    navigator.geolocation.getCurrentPosition(
      (p) => { setUserPos({ lat: p.coords.latitude, lon: p.coords.longitude }); setGeo('on') },
      () => setGeo('denied'),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    )
  }
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true) // czy „przyklejać" widok do dołu (tylko gdy user jest przy dole)
  const lastLocalWrite = useRef(0) // pomija echo realtime po własnym zapisie (żeby nie gubić optymistycznych wiadomości)
  const onScroll = () => {
    const el = scrollAreaRef.current
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  // Klik w przystanek planu → szczegóły miejsca (modal jak w Przewodniku) albo Google Maps.
  const openPlace = async (s: AssistantPlanStop) => {
    if (s.guide_place_id) {
      const { data } = await supabase
        .from('guide_places')
        .select('id,name,category,description,lat,lon,google_rating,google_total_ratings')
        .eq('id', s.guide_place_id).maybeSingle()
      if (data) { setDetailPlace(data as unknown as GuideFallback); return }
    }
    if (s.lat != null && s.lon != null) {
      window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.name)}%20${s.lat},${s.lon}`, '_blank')
    }
  }

  // Reset wspólnego czatu (czyści dla całej ekipy; realtime usunie u innych).
  const resetChat = async () => {
    if (sending) return
    if (!window.confirm('Wyczyścić cały czat asystenta? Zniknie dla całej ekipy.')) return
    lastLocalWrite.current = Date.now()
    setMessages([])
    await supabase.from('assistant_messages').delete().eq('room_id', room.id)
  }

  const load = async () => {
    const { data } = await supabase
      .from('assistant_messages')
      .select('*')
      .eq('room_id', room.id)
      .order('created_at', { ascending: true })
    setMessages((data as AssistantMessage[]) || [])
  }

  useEffect(() => {
    load()
    const ch = supabase
      .channel(`assistant:${room.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assistant_messages', filter: `room_id=eq.${room.id}` }, () => {
        if (Date.now() - lastLocalWrite.current < 1500) return // pomiń echo własnego zapisu
        load()
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id])

  useEffect(() => { if (stickRef.current) bottomRef.current?.scrollIntoView({ block: 'end' }) }, [messages.length, sending, liveReply])

  const send = async (text: string) => {
    const q = text.trim()
    if (!q || sending) return
    setInput('')
    setSending(true)
    setSteps([])
    setLiveReply('')
    stickRef.current = true // nowe pytanie → zjedź na dół
    lastLocalWrite.current = Date.now()
    // wstaw pytanie (wspólne, realtime)
    const { data: userRow } = await supabase
      .from('assistant_messages')
      .insert({ room_id: room.id, role: 'user', content: q, author_name: myName, session_id: sessionId })
      .select().single()
    if (userRow) setMessages((p) => [...p, userRow as AssistantMessage])

    const history = [...messages, userRow as AssistantMessage]
      .filter(Boolean)
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.content }))

    let reply = ''
    let plan: AssistantPlan | null = null
    let sources: { title: string; url: string }[] | null = null
    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: room.id, messages: history, loc: userPos || undefined }),
      })
      // strumień NDJSON: kroki na żywo + finalne „done"
      const reader = res.body?.getReader()
      const dec = new TextDecoder()
      let buf = ''
      if (reader) {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          let nl
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim()
            buf = buf.slice(nl + 1)
            if (!line) continue
            try {
              const ev = JSON.parse(line)
              if (ev.type === 'step') setSteps((p) => [...p, { icon: ev.icon || '•', label: ev.label || '' }])
              else if (ev.type === 'delta') setLiveReply((p) => p + (ev.text || ''))
              else if (ev.type === 'done') { reply = ev.reply || ''; plan = ev.plan || null; sources = (ev.sources && ev.sources.length) ? ev.sources : null }
            } catch { /* pomiń niekompletną linię */ }
          }
        }
      }
    } catch {
      reply = ''
    }
    if (!reply) reply = 'Nie udało się teraz odpowiedzieć. Spróbuj ponownie za chwilę.'

    lastLocalWrite.current = Date.now()
    const { data: botRow } = await supabase
      .from('assistant_messages')
      .insert({ room_id: room.id, role: 'assistant', content: reply, plan, sources })
      .select().single()
    if (botRow) setMessages((p) => [...p, botRow as AssistantMessage])
    setSteps([])
    setLiveReply('')
    setSending(false)
  }

  return (
    <div className="flex flex-col h-full max-w-lg mx-auto w-full">
      <div className="shrink-0 px-4 pt-4 pb-2">
        <div className="flex items-center gap-2 pr-8">
          <h2 className="font-display text-lg font-semibold text-stone-100 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-forest-400" /> Asystent
          </h2>
          {messages.length > 0 && (
            <button onClick={resetChat} disabled={sending} title="Wyczyść czat" className="text-stone-500 hover:text-red-400 p-1 rounded-lg hover:bg-stone-800 disabled:opacity-40 transition-colors">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
        <p className="text-stone-500 text-xs mt-0.5">Pyta o Słowenię i miejsca z poradnika, ułoży plan dnia. Czat wspólny dla ekipy.</p>
      </div>

      <div ref={scrollAreaRef} onScroll={onScroll} className="flex-1 overflow-y-auto overscroll-contain px-4 min-h-0">
      {messages.length === 0 && !sending && (
        <div className="mb-4">
          <p className="text-stone-500 text-xs mb-2">Na start, np.:</p>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => send(s)} className="text-xs px-2.5 py-1.5 rounded-full bg-stone-800/60 border border-stone-700/40 text-stone-300 hover:text-white hover:border-forest-700/50 transition-colors">
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        {messages.map((m) => (
          <div key={m.id} className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {m.role === 'assistant' && (
              <div className="w-7 h-7 rounded-full bg-forest-700/40 border border-forest-700/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Bot className="w-4 h-4 text-forest-300" />
              </div>
            )}
            <div className={`max-w-[85%] ${m.role === 'user' ? 'order-1' : ''}`}>
              {m.role === 'user' ? (
                <div className="rounded-2xl rounded-tr-sm bg-water-700/30 border border-water-700/40 px-3 py-2">
                  {m.author_name && <p className="text-[10px] text-water-400 mb-0.5">{m.author_name}</p>}
                  <p className="text-sm text-stone-100 whitespace-pre-wrap">{m.content}</p>
                </div>
              ) : (
                <div className="rounded-2xl rounded-tl-sm bg-stone-800/50 border border-stone-700/40 px-3 py-2">
                  <RichText text={m.content} />
                  {m.plan && m.plan.stops?.length > 0 && (
                    <PlanBlock plan={m.plan} room={room} addStops={addStops} maxDayIndex={maxDayIndex} onOpenPlace={openPlace} />
                  )}
                  {m.sources && m.sources.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-stone-700/40">
                      <p className="text-[10px] text-stone-500 mb-1">Źródła:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {m.sources.map((s, i) => (
                          <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-water-400 hover:text-water-300 inline-flex items-center gap-1 bg-stone-800/60 border border-stone-700/40 rounded-full px-2 py-0.5 max-w-[200px]">
                            <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" /> <span className="truncate">{s.title}</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            {m.role === 'user' && (
              <div className="w-7 h-7 rounded-full bg-water-700/40 border border-water-700/50 flex items-center justify-center flex-shrink-0 mt-0.5 order-2">
                <User className="w-4 h-4 text-water-300" />
              </div>
            )}
          </div>
        ))}

        {sending && (
          <div className="flex gap-2 justify-start">
            <div className="w-7 h-7 rounded-full bg-forest-700/40 border border-forest-700/50 flex items-center justify-center flex-shrink-0">
              <Bot className="w-4 h-4 text-forest-300" />
            </div>
            <div className="rounded-2xl rounded-tl-sm bg-stone-800/50 border border-stone-700/40 px-3 py-2.5 min-w-0">
              {liveReply ? (
                <RichText text={liveReply} />
              ) : steps.length > 0 ? (
                <div className="space-y-1">
                  {steps.map((s, i) => (
                    <p key={i} className={`text-xs flex items-start gap-1.5 ${i === steps.length - 1 ? 'text-stone-300' : 'text-stone-500'}`}>
                      <span className="flex-shrink-0">{s.icon}</span> <span className="break-words">{s.label}</span>
                    </p>
                  ))}
                </div>
              ) : (
                <span className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-stone-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-stone-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-stone-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                </span>
              )}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      </div>

      {/* Pole wpisywania (przyklejone do dołu nakładki) */}
      <div className="shrink-0 border-t border-stone-800 bg-stone-900 px-3 pt-2 pb-3">
        <button
          onClick={askLocation}
          disabled={geo === 'loading'}
          className={`mb-1.5 inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border transition-colors disabled:opacity-60 ${geo === 'on' ? 'bg-forest-700/30 border-forest-700/50 text-forest-300' : 'bg-stone-800/60 border-stone-700/50 text-stone-400 hover:text-stone-200'}`}
        >
          <Crosshair className="w-3 h-3" />
          {geo === 'on' ? 'Lokalizacja włączona' : geo === 'loading' ? 'Ustalam lokalizację…' : geo === 'denied' ? 'Brak zgody — spróbuj ponownie' : 'Użyj mojej lokalizacji'}
        </button>
        <div className="flex items-end gap-2 rounded-2xl border border-stone-700 bg-stone-800 p-1.5">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }}
            rows={1}
            placeholder="Zapytaj o Słowenię lub poproś o plan…"
            className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-stone-100 placeholder-stone-600 focus:outline-none max-h-28"
          />
          <button
            onClick={() => send(input)}
            disabled={sending || !input.trim()}
            className="flex-shrink-0 w-9 h-9 rounded-xl bg-forest-600 hover:bg-forest-500 text-white flex items-center justify-center disabled:opacity-40 transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        <p className="text-[10px] text-stone-600 text-center mt-1 px-2">AI może się mylić — zweryfikuj godziny, ceny i dojazd przed wyjazdem.</p>
      </div>

      {detailPlace && (
        <GuideDetailModal
          place={detailPlace}
          dist={null}
          catLabel={CATMAP[detailPlace.category]?.label || detailPlace.category}
          catEmoji={CATMAP[detailPlace.category]?.emoji || '📍'}
          onClose={() => setDetailPlace(null)}
        />
      )}
    </div>
  )
}
