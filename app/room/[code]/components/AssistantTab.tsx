'use client'

// Asystent AI (opcjonalny dodatek). Wspólny czat pokoju: pytania o Słowenię i
// miejsca z poradnika + plan dnia z przyciskiem „Wrzuć do planera".
// Usuwalny: skasuj ten plik + /api/assistant + wpis w AppShell + DROP TABLE assistant_messages.

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase, Room, AssistantMessage, AssistantPlan } from '@/lib/supabase'
import { getSessionId, getSessionName } from '@/lib/session'
import { useItinerary } from './useItinerary'
import { tripDayCount } from './itineraryUtils'
import { Sparkles, Send, CalendarPlus, Check, Bot, User } from 'lucide-react'

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

function PlanBlock({ plan, room, addStop, maxDayIndex }: {
  plan: AssistantPlan
  room: Room
  addStop: (_dayIndex: number, _stop: any) => Promise<void>
  maxDayIndex: number
}) {
  const days = Math.max(1, tripDayCount(room, maxDayIndex, 0))
  const [day, setDay] = useState(1)
  const [state, setState] = useState<'idle' | 'adding' | 'done'>('idle')

  const add = async () => {
    if (state === 'adding') return
    setState('adding')
    for (const s of plan.stops) {
      await addStop(day - 1, {
        place_name: s.name,
        place_id: s.place_id ?? null,
        lat: s.lat ?? null,
        lon: s.lon ?? null,
        duration_min: s.duration_min ?? null,
      })
    }
    setState('done')
  }

  return (
    <div className="mt-2 rounded-xl border border-forest-800/40 bg-forest-900/15 p-3">
      {plan.title && <p className="text-forest-300 text-xs font-semibold mb-1.5">🗺️ {plan.title}</p>}
      <ol className="list-decimal pl-5 space-y-1 text-xs text-stone-300">
        {plan.stops.map((s, i) => (
          <li key={i}>
            <span className="text-stone-100 font-medium">{s.name}</span>
            {s.duration_min ? <span className="text-stone-500"> · ~{s.duration_min} min</span> : null}
            {s.note ? <span className="text-stone-400"> — {s.note}</span> : null}
          </li>
        ))}
      </ol>
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
  const { items, addStop } = useItinerary(room.id, sessionId)
  const maxDayIndex = useMemo(() => items.reduce((m, it) => Math.max(m, it.day_index), 0), [items])

  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

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

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages.length, sending])

  const send = async (text: string) => {
    const q = text.trim()
    if (!q || sending) return
    setInput('')
    setSending(true)
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
    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: room.id, messages: history }),
      })
      const d = await res.json()
      reply = d?.reply || ''
      plan = d?.plan || null
    } catch {
      reply = ''
    }
    if (!reply) reply = 'Nie udało się teraz odpowiedzieć. Spróbuj ponownie za chwilę.'

    const { data: botRow } = await supabase
      .from('assistant_messages')
      .insert({ room_id: room.id, role: 'assistant', content: reply, plan })
      .select().single()
    if (botRow) setMessages((p) => [...p, botRow as AssistantMessage])
    setSending(false)
  }

  return (
    <div className="px-4 py-5 max-w-lg mx-auto">
      <div className="mb-3">
        <h2 className="font-display text-lg font-semibold text-stone-100 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-forest-400" /> Asystent
        </h2>
        <p className="text-stone-500 text-xs mt-0.5">Pyta o Słowenię i miejsca z poradnika, ułoży plan dnia. Czat wspólny dla ekipy.</p>
      </div>

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
                    <PlanBlock plan={m.plan} room={room} addStop={addStop} maxDayIndex={maxDayIndex} />
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
            <div className="rounded-2xl rounded-tl-sm bg-stone-800/50 border border-stone-700/40 px-3 py-2.5">
              <span className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-stone-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-stone-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-stone-500 animate-bounce" style={{ animationDelay: '300ms' }} />
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Pole wpisywania */}
      <div className="sticky bottom-[5.5rem] mt-4 bg-stone-950/80 backdrop-blur rounded-2xl">
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
    </div>
  )
}
