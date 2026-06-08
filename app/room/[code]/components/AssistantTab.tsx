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
import { Sparkles, Send, CalendarPlus, Check, Bot, User, ExternalLink, Info, Map as MapIcon, Car, Trash2 } from 'lucide-react'

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
      <ol className="space-y-1 text-xs text-stone-300">
        {plan.stops.map((s, i) => (
          <li key={i}>
            {i > 0 && s.drive_min_from_prev ? (
              <p className="text-[10px] text-stone-500 flex items-center gap-1 pl-1 my-0.5"><Car className="w-2.5 h-2.5" /> ~{s.drive_min_from_prev} min dojazdu</p>
            ) : null}
            <div className="flex items-start gap-1.5">
              <span className="text-forest-400 font-semibold flex-shrink-0">{i + 1}.</span>
              <div className="min-w-0">
                <button onClick={() => onOpenPlace(s)} className="text-stone-100 font-medium text-left hover:text-water-300 inline-flex items-center gap-1">
                  {s.name}{(s.guide_place_id || s.lat != null) && <Info className="w-3 h-3 text-stone-500 flex-shrink-0" />}
                </button>
                {s.duration_min ? <span className="text-stone-500"> · ~{s.duration_min} min</span> : null}
                {s.note ? <span className="text-stone-400 block">{s.note}</span> : null}
              </div>
            </div>
          </li>
        ))}
      </ol>

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
  const [detailPlace, setDetailPlace] = useState<GuideFallback | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true) // czy „przyklejać" widok do dołu (tylko gdy user jest przy dole)
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assistant_messages', filter: `room_id=eq.${room.id}` }, load)
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
        body: JSON.stringify({ roomId: room.id, messages: history }),
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
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-lg font-semibold text-stone-100 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-forest-400" /> Asystent
          </h2>
          {messages.length > 0 && (
            <button onClick={resetChat} disabled={sending} title="Wyczyść czat" className="text-stone-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-stone-800 disabled:opacity-40 transition-colors">
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
