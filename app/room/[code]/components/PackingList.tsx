'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase, PackingItem, PackingProfile, Room, UserPreference } from '@/lib/supabase'
import { getSessionId, getSessionName } from '@/lib/session'
import {
  Plus, Check, Trash2, ChevronDown, ChevronRight, RefreshCw,
  Sparkles, Hand, Loader2, Cloud, User, X,
} from 'lucide-react'
import PackingAnimation from './PackingAnimation'

// Opisy AI ("dlaczego ta rzecz") są zapisywane w DB do celów debugu, ale dla
// użytkownika są zbędne. Przełącz na true, by zobaczyć je na kartach (debug).
const DEBUG_AI_REASONS = false

const CATEGORIES = [
  { id: 'ubrania', label: '👕 Ubrania' },
  { id: 'kosmetyki', label: '🧴 Higiena i kosmetyki' },
  { id: 'elektronika', label: '🔌 Elektronika' },
  { id: 'sprzet', label: '🏄 Sprzęt' },
  { id: 'jedzenie', label: '🍖 Jedzenie' },
  { id: 'nocleg', label: '🏕️ Nocleg' },
  { id: 'dokumenty', label: '📄 Dokumenty' },
  { id: 'inne', label: '📦 Inne' },
]

const GENDER_OPTIONS = [
  { id: 'female', label: '♀ Kobieta' },
  { id: 'male', label: '♂ Mężczyzna' },
  { id: 'other', label: '⚧ Inne' },
  { id: 'unspecified', label: '🙈 Wolę nie podawać' },
]

const TOGGLE_OPTIONS = [
  { id: 'ownMeds', label: '💊 Biorę własne leki' },
  { id: 'cosmetics', label: '🧴 Rozbudowana kosmetyczka' },
  { id: 'contactLenses', label: '👓 Soczewki / okulary' },
  { id: 'electronics', label: '💻 Laptop / tablet' },
  { id: 'makeup', label: '💄 Makijaż' },
]

type AiItemResponse = {
  category: string
  name: string
  qty: string | null
  ai_reason: string | null
  shared_gear?: boolean
}

interface Props {
  room: Room
  myPrefs: UserPreference
  allPrefs?: UserPreference[]
}

export default function PackingList({ room, myPrefs, allPrefs = [] }: Props) {
  const [items, setItems] = useState<PackingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'personal' | 'shared'>('personal')
  const [profile, setProfile] = useState<PackingProfile | null>(null)
  const [weatherSummary, setWeatherSummary] = useState<string | null>(null)

  const [showProfileForm, setShowProfileForm] = useState(false)
  const [formGender, setFormGender] = useState<string>('unspecified')
  const [formToggles, setFormToggles] = useState<Record<string, boolean>>({})

  const [generatingPersonal, setGeneratingPersonal] = useState(false)
  const [generatingShared, setGeneratingShared] = useState(false)
  // Trzymamy animację zamontowaną także w trakcie wyjścia (outro), aż samo
  // PackingAnimation zawoła onComplete — wtedy odsłaniamy gotową listę.
  const [packAnimActive, setPackAnimActive] = useState(false)

  const [newItemText, setNewItemText] = useState('')
  const [newItemCategory, setNewItemCategory] = useState('ubrania')
  const [adding, setAdding] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set())

  const sessionId = getSessionId()
  const myName = getSessionName()
  const autoRan = useRef(false)

  // Agregacja aktywności ekipy (jak wcześniej)
  const groupActivities = (() => {
    const completed = allPrefs.filter(p => p.completed)
    if (completed.length === 0) return myPrefs.activities || []
    const counts: Record<string, number> = {}
    completed.forEach(p => (p.activities || []).forEach(a => { counts[a] = (counts[a] || 0) + 1 }))
    return Object.entries(counts).filter(([, c]) => c >= 1).map(([id]) => id)
  })()

  const myPersonal = items.filter(i => i.scope === 'personal' && i.owner_session === sessionId)
  const shared = items.filter(i => i.scope === 'shared')
  const visible = view === 'personal' ? myPersonal : shared

  useEffect(() => {
    init()
    const channel = supabase
      .channel(`packing:${room.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'packing_items',
        filter: `room_id=eq.${room.id}`,
      }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const incoming = payload.new as PackingItem
          // pomijamy cudze pozycje osobiste (prywatność na poziomie UI)
          if (incoming.scope === 'personal' && incoming.owner_session !== sessionId) return
          setItems(prev => prev.some(i => i.id === incoming.id) ? prev : [...prev, incoming])
        } else if (payload.eventType === 'UPDATE') {
          const updated = payload.new as PackingItem
          if (updated.scope === 'personal' && updated.owner_session !== sessionId) return
          setItems(prev => prev.map(i => i.id === updated.id ? updated : i))
        } else if (payload.eventType === 'DELETE') {
          setItems(prev => prev.filter(i => i.id !== (payload.old as { id: string }).id))
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id])

  // Gdy startuje generowanie dla aktualnego widoku — pokaż animację. Wygaszenie
  // (po wyjściu) robi samo PackingAnimation przez onComplete.
  useEffect(() => {
    const gen = view === 'personal' ? generatingPersonal : generatingShared
    if (gen) setPackAnimActive(true)
  }, [generatingPersonal, generatingShared, view])

  async function init() {
    setLoading(true)
    const [itemsRes, profRes, metaRes] = await Promise.all([
      supabase
        .from('packing_items')
        .select('*')
        .eq('room_id', room.id)
        .or(`scope.eq.shared,owner_session.eq.${sessionId}`)
        .order('created_at', { ascending: true }),
      supabase
        .from('packing_profiles')
        .select('*')
        .eq('room_id', room.id)
        .eq('session_id', sessionId)
        .maybeSingle(),
      supabase
        .from('packing_meta')
        .select('*')
        .eq('room_id', room.id)
        .maybeSingle(),
    ])

    const loaded = (itemsRes.data || []) as PackingItem[]
    const prof = (profRes.data || null) as PackingProfile | null
    const meta = metaRes.data as { shared_generated_at: string | null; weather_summary: string | null } | null

    setItems(loaded)
    setProfile(prof)
    if (prof) {
      setFormGender(prof.gender || 'unspecified')
      setFormToggles(prof.toggles || {})
    }
    if (meta?.weather_summary) setWeatherSummary(meta.weather_summary)
    setLoading(false)

    if (autoRan.current) return
    autoRan.current = true

    const myPers = loaded.filter(i => i.scope === 'personal' && i.owner_session === sessionId)
    const aiShared = loaded.filter(i => i.scope === 'shared' && i.ai_generated)

    // Lista osobista: jeśli pusta → generuj (lub poproś o profil)
    if (myPers.length === 0) {
      if (prof) generatePersonal(prof, loaded)
      else setShowProfileForm(true)
    }

    // Lista wspólna AI: generujemy raz na pokój
    if (aiShared.length === 0 && !meta?.shared_generated_at) {
      generateShared(loaded)
    }
  }

  function existingNamesFrom(list: PackingItem[]): string[] {
    return Array.from(new Set(list.map(i => i.name.toLowerCase())))
  }

  async function generatePersonal(prof: PackingProfile, currentItems: PackingItem[]) {
    if (generatingPersonal) return
    setGeneratingPersonal(true)
    try {
      const res = await fetch('/api/packing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'personal',
          room,
          profile: { gender: prof.gender, toggles: prof.toggles },
          person: {
            user_name: myPrefs.user_name,
            activities: myPrefs.activities,
            intensity: myPrefs.intensity,
            accommodation: myPrefs.accommodation,
            budget: myPrefs.budget,
            food: myPrefs.food,
          },
          existingNames: existingNamesFrom(currentItems),
        }),
      })
      const data = await res.json()
      if (data?.weatherSummary) setWeatherSummary(data.weatherSummary)
      const aiItems: AiItemResponse[] = Array.isArray(data?.items) ? data.items : []
      if (aiItems.length === 0) return
      const toInsert = aiItems.map(it => ({
        room_id: room.id,
        category: it.category,
        name: it.name,
        checked: false,
        added_by: 'AI',
        added_by_session: 'ai',
        scope: 'personal',
        owner_session: sessionId,
        ai_generated: true,
        ai_reason: it.ai_reason,
        qty: it.qty,
      }))
      const { data: inserted } = await supabase.from('packing_items').insert(toInsert).select()
      if (inserted) mergeItems(inserted as PackingItem[])
    } finally {
      setGeneratingPersonal(false)
    }
  }

  async function generateShared(currentItems: PackingItem[]) {
    if (generatingShared) return
    setGeneratingShared(true)
    try {
      const sharedNames = existingNamesFrom(currentItems.filter(i => i.scope === 'shared'))
      const res = await fetch('/api/packing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'shared',
          room,
          groupActivities,
          accommodation: myPrefs.accommodation,
          existingNames: sharedNames,
        }),
      })
      const data = await res.json()
      const summary = data?.weatherSummary || null
      if (summary) setWeatherSummary(summary)
      const aiItems: AiItemResponse[] = Array.isArray(data?.items) ? data.items : []
      const filtered = aiItems.filter(it => !sharedNames.includes(it.name.toLowerCase()))
      if (filtered.length > 0) {
        const toInsert = filtered.map(it => ({
          room_id: room.id,
          category: it.category,
          name: it.name,
          checked: false,
          added_by: 'AI',
          added_by_session: 'ai',
          scope: 'shared',
          owner_session: null,
          ai_generated: true,
          ai_reason: it.ai_reason,
          qty: it.qty,
          shared_gear: Boolean(it.shared_gear),
        }))
        const { data: inserted } = await supabase.from('packing_items').insert(toInsert).select()
        if (inserted) mergeItems(inserted as PackingItem[])
      }
      // oznacz, że wspólna lista AI została wygenerowana (raz na pokój)
      await supabase.from('packing_meta').upsert({
        room_id: room.id,
        shared_generated_at: new Date().toISOString(),
        weather_summary: summary,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'room_id' })
    } finally {
      setGeneratingShared(false)
    }
  }

  function mergeItems(newOnes: PackingItem[]) {
    setItems(prev => {
      const ids = new Set(prev.map(i => i.id))
      const add = newOnes.filter(i => !ids.has(i.id))
      return [...prev, ...add]
    })
  }

  async function saveProfileAndGenerate() {
    const payload = {
      room_id: room.id,
      session_id: sessionId,
      gender: formGender,
      toggles: formToggles,
      updated_at: new Date().toISOString(),
    }
    const { data } = await supabase
      .from('packing_profiles')
      .upsert(payload, { onConflict: 'room_id,session_id' })
      .select()
      .single()
    const prof = (data || { ...payload, id: '', created_at: '' }) as PackingProfile
    setProfile(prof)
    setShowProfileForm(false)

    // usuń poprzednie pozycje AI tej osoby (świadoma regeneracja), zostaw ręczne
    const myAi = myPersonal.filter(i => i.ai_generated)
    if (myAi.length > 0) {
      const ids = myAi.map(i => i.id)
      await supabase.from('packing_items').delete().in('id', ids)
      setItems(prev => prev.filter(i => !ids.includes(i.id)))
    }
    const remaining = items.filter(i => !myAi.some(a => a.id === i.id))
    await generatePersonal(prof, remaining)
  }

  async function regenerateShared() {
    if (generatingShared) return
    if (!confirm('Wyczyszczę wspólną listę z pozycji dodanych automatycznie (także starych) i wygeneruję ją na nowo lepszym algorytmem. Twoje ręczne wpisy zostają. Kontynuować?')) return
    // FIX3: soft-lock — atomowo przejmij blokadę regeneracji. Jeśli ktoś z ekipy
    // już regeneruje wspólną listę, przerwij, żeby nie zdublować pozycji AI.
    const { data: claimed } = await supabase.rpc('claim_shared_regen', { p_room_id: room.id, p_ttl_seconds: 90 })
    if (!claimed) {
      alert('Ktoś z ekipy właśnie regeneruje wspólną listę. Poczekaj chwilę i odśwież.')
      return
    }
    try {
      // Usuwamy zarówno świeże pozycje AI, jak i stare, automatycznie zasiane (added_by='system'/'AI').
      // Ręczne wpisy ekipy (added_by = imię) zostają nietknięte.
      const toClear = shared.filter(i => i.ai_generated || i.added_by === 'system' || i.added_by === 'AI')
      if (toClear.length > 0) {
        const ids = toClear.map(i => i.id)
        await supabase.from('packing_items').delete().in('id', ids)
        setItems(prev => prev.filter(i => !ids.includes(i.id)))
      }
      // Reset znacznika, żeby wymusić świeżą generację (gdyby ktoś jeszcze raz wszedł).
      await supabase.from('packing_meta').upsert({
        room_id: room.id,
        shared_generated_at: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'room_id' })
      const remaining = items.filter(i => !toClear.some(a => a.id === i.id))
      await generateShared(remaining)
    } finally {
      // Zwolnij blokadę niezależnie od wyniku.
      await supabase.rpc('release_shared_regen', { p_room_id: room.id })
    }
  }

  function openAddModal() {
    setNewItemText('')
    setNewItemCategory(view === 'personal' ? 'ubrania' : 'sprzet')
    setShowAddForm(true)
  }

  async function addItem() {
    if (!newItemText.trim()) return
    setAdding(true)
    const row = {
      room_id: room.id,
      category: newItemCategory,
      name: newItemText.trim(),
      checked: false,
      added_by: myName,
      added_by_session: sessionId,
      ai_generated: false,
      scope: view === 'personal' ? 'personal' : 'shared',
      owner_session: (view === 'personal' ? sessionId : null) as string | null,
    }
    const { data } = await supabase.from('packing_items').insert(row).select().single()
    if (data) mergeItems([data as PackingItem])
    setNewItemText('')
    setShowAddForm(false)
    setAdding(false)
  }

  async function toggleItem(item: PackingItem) {
    const { data } = await supabase
      .from('packing_items').update({ checked: !item.checked }).eq('id', item.id).select().single()
    if (data) setItems(prev => prev.map(i => i.id === item.id ? data as PackingItem : i))
  }

  async function deleteItem(id: string) {
    await supabase.from('packing_items').delete().eq('id', id)
    setItems(prev => prev.filter(i => i.id !== id))
  }

  async function claimItem(item: PackingItem, take: boolean) {
    const patch = take
      ? { claimed_by: sessionId, claimed_by_name: myName }
      : { claimed_by: null, claimed_by_name: null }
    const { data } = await supabase.from('packing_items').update(patch).eq('id', item.id).select().single()
    if (data) setItems(prev => prev.map(i => i.id === item.id ? data as PackingItem : i))
  }

  function toggleCategory(cat: string) {
    setCollapsedCats(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat); else next.add(cat)
      return next
    })
  }

  const checkedCount = visible.filter(i => i.checked).length
  const generating = view === 'personal' ? generatingPersonal : generatingShared

  if (loading) {
    return <div className="flex items-center justify-center py-16 text-stone-600 text-sm animate-pulse">Wczytuję listę pakowania...</div>
  }

  return (
    <div className="px-4 py-5 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-lg font-semibold text-stone-100">Pakowanie</h2>
        <span className="text-xs text-stone-500 bg-stone-800 px-2.5 py-1 rounded-full">{checkedCount} / {visible.length}</span>
      </div>

      {/* Segmenty Moja / Wspólne */}
      <div className="flex gap-1 p-1 bg-stone-900 border border-stone-800 rounded-2xl mb-4">
        <button
          onClick={() => { setView('personal'); setNewItemCategory('ubrania'); setShowAddForm(false) }}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-medium transition-all ${view === 'personal' ? 'bg-forest-600 text-white' : 'text-stone-400 hover:text-stone-200'}`}
        >
          <User className="w-4 h-4" /> Moja lista
        </button>
        <button
          onClick={() => { setView('shared'); setNewItemCategory('sprzet'); setShowAddForm(false) }}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-medium transition-all ${view === 'shared' ? 'bg-water-600 text-white' : 'text-stone-400 hover:text-stone-200'}`}
        >
          🎒 Wspólne
        </button>
      </div>

      {/* Dodaj — przycisk u góry (otwiera okienko na środku) */}
      {!showProfileForm && (
        <button
          onClick={openAddModal}
          className="w-full flex items-center justify-center gap-2 bg-stone-800/60 border border-stone-700 hover:border-forest-600 hover:text-forest-300 rounded-xl px-4 py-2.5 text-stone-300 transition-all text-sm font-medium mb-4"
        >
          <Plus className="w-4 h-4" /> {view === 'personal' ? 'Dodaj do mojej listy' : 'Dodaj do wspólnych'}
        </button>
      )}

      {/* Pasek pogody */}
      {weatherSummary && (
        <div className="flex items-start gap-2 bg-water-900/20 border border-water-800/30 rounded-xl px-3 py-2.5 mb-4">
          <Cloud className="w-4 h-4 text-water-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-water-200/90 leading-relaxed">{weatherSummary}</p>
        </div>
      )}

      {/* Formularz profilu (lista osobista, pierwsze wejście / zmiana) */}
      {view === 'personal' && showProfileForm && (
        <div className="bg-stone-900 border border-stone-700 rounded-2xl p-4 mb-4">
          <p className="text-sm text-stone-300 font-medium mb-1">Dopasuję listę pod Ciebie 🎯</p>
          <p className="text-xs text-stone-500 mb-3">Kilka pytań, żeby lista była trafna. Widoczna tylko dla Ciebie.</p>

          <p className="text-xs text-stone-400 mb-1.5">Płeć</p>
          <div className="grid grid-cols-2 gap-1.5 mb-3">
            {GENDER_OPTIONS.map(g => (
              <button
                key={g.id}
                onClick={() => setFormGender(g.id)}
                className={`py-2 rounded-xl text-xs border transition-all ${formGender === g.id ? 'bg-forest-600 border-forest-600 text-white' : 'bg-stone-800 border-stone-700 text-stone-400'}`}
              >{g.label}</button>
            ))}
          </div>

          <p className="text-xs text-stone-400 mb-1.5">Dotyczy mnie</p>
          <div className="flex flex-wrap gap-1.5 mb-4">
            {TOGGLE_OPTIONS.map(t => {
              const on = !!formToggles[t.id]
              return (
                <button
                  key={t.id}
                  onClick={() => setFormToggles(prev => ({ ...prev, [t.id]: !prev[t.id] }))}
                  className={`px-2.5 py-1.5 rounded-full text-xs border transition-all ${on ? 'bg-forest-800/40 border-forest-600 text-forest-300' : 'bg-stone-800 border-stone-700 text-stone-500'}`}
                >{t.label}</button>
              )
            })}
          </div>

          <button
            onClick={saveProfileAndGenerate}
            disabled={generatingPersonal}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-forest-600 hover:bg-forest-500 disabled:bg-stone-700 text-white text-sm font-medium transition-colors"
          >
            {generatingPersonal ? <><Loader2 className="w-4 h-4 animate-spin" /> Generuję...</> : <><Sparkles className="w-4 h-4" /> Wygeneruj moją listę</>}
          </button>
        </div>
      )}

      {/* Stan generowania — animacja pakowania do plecaka (gra też outro) */}
      {packAnimActive && !showProfileForm && (
        <PackingAnimation
          variant={view === 'personal' ? 'personal' : 'shared'}
          ready={!generating}
          onComplete={() => setPackAnimActive(false)}
        />
      )}

      {/* Pusta lista osobista bez profilu */}
      {view === 'personal' && !generating && !packAnimActive && !showProfileForm && myPersonal.length === 0 && (
        <button
          onClick={() => setShowProfileForm(true)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-forest-600/90 hover:bg-forest-500 text-white text-sm font-medium transition-colors mb-4"
        >
          <Sparkles className="w-4 h-4" /> Wygeneruj moją listę
        </button>
      )}

      {/* Lista (progress + kategorie) — ukryta dopóki gra animacja/outro,
          potem odsłania się płynnie razem (animate-fade-up). */}
      {!packAnimActive && (
      <div className="animate-fade-up">
      {/* Progress */}
      {visible.length > 0 && (
        <div className="h-1.5 bg-stone-800 rounded-full overflow-hidden mb-5">
          <div
            className="h-full bg-gradient-to-r from-forest-500 to-water-500 rounded-full transition-all duration-500"
            style={{ width: `${(checkedCount / visible.length) * 100}%` }}
          />
        </div>
      )}

      {/* Kategorie */}
      {CATEGORIES.map(cat => {
        const catItems = visible.filter(i => i.category === cat.id)
        if (catItems.length === 0) return null
        const collapsed = collapsedCats.has(cat.id)
        const catChecked = catItems.filter(i => i.checked).length

        return (
          <div key={cat.id} className="mb-4">
            <button onClick={() => toggleCategory(cat.id)} className="w-full flex items-center justify-between py-2">
              <div className="flex items-center gap-2">
                {collapsed ? <ChevronRight className="w-4 h-4 text-stone-600" /> : <ChevronDown className="w-4 h-4 text-stone-500" />}
                <span className="text-sm font-medium text-stone-300">{cat.label}</span>
                <span className="text-xs text-stone-600">{catChecked}/{catItems.length}</span>
              </div>
            </button>

            {!collapsed && (
              <div className="space-y-1 ml-1">
                {catItems.map(item => (
                  <div key={item.id} className={`px-3 py-2.5 rounded-xl border transition-all group ${item.checked ? 'bg-stone-800/20 border-stone-800 opacity-50' : 'bg-stone-800/50 border-stone-700/50'}`}>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => toggleItem(item)}
                        className={`w-5 h-5 rounded-md border flex-shrink-0 flex items-center justify-center transition-all ${item.checked ? 'bg-forest-600 border-forest-600' : 'border-stone-600 hover:border-forest-500'}`}
                      >
                        {item.checked && <Check className="w-3 h-3 text-white" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-sm ${item.checked ? 'line-through text-stone-600' : 'text-stone-200'}`}>{item.name}</span>
                          {item.qty && <span className="text-[10px] font-medium text-amber-300/90 bg-amber-900/20 border border-amber-800/30 px-1.5 py-0.5 rounded-full">{item.qty}</span>}
                          {item.ai_generated && <Sparkles className="w-3 h-3 text-forest-500/70" />}
                        </div>
                        {DEBUG_AI_REASONS && item.ai_reason && !item.checked && (
                          <p className="text-[11px] text-stone-500 mt-0.5 leading-snug">{item.ai_reason}</p>
                        )}
                      </div>
                      {!item.shared_gear && item.added_by !== 'system' && item.added_by !== 'AI' && (
                        <span className="text-stone-700 text-xs flex-shrink-0">{item.added_by}</span>
                      )}
                      <button onClick={() => deleteItem(item.id)} className="text-stone-700 hover:text-red-400 transition-colors p-0.5 opacity-0 group-hover:opacity-100 flex-shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Kto to bierze? — tylko wspólny sprzęt */}
                    {item.shared_gear && (
                      <div className="mt-2 ml-8">
                        {item.claimed_by ? (
                          item.claimed_by === sessionId ? (
                            <button
                              onClick={() => claimItem(item, false)}
                              className="inline-flex items-center gap-1.5 text-xs bg-forest-800/40 text-forest-300 border border-forest-700/40 px-2.5 py-1 rounded-full"
                            >
                              <Check className="w-3 h-3" /> Bierzesz Ty · cofnij
                            </button>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-xs bg-stone-800 text-stone-400 border border-stone-700/40 px-2.5 py-1 rounded-full">
                              <Hand className="w-3 h-3" /> Bierze: {item.claimed_by_name || 'ktoś'}
                            </span>
                          )
                        ) : (
                          <button
                            onClick={() => claimItem(item, true)}
                            className="inline-flex items-center gap-1.5 text-xs bg-water-800/30 text-water-300 border border-water-700/40 hover:bg-water-700/40 px-2.5 py-1 rounded-full transition-colors"
                          >
                            <Hand className="w-3 h-3" /> Ja to biorę
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {/* Regeneruj */}
      {!showProfileForm && (
        view === 'personal' ? (
          <button
            onClick={() => setShowProfileForm(true)}
            disabled={generatingPersonal}
            className="w-full flex items-center justify-center gap-2 mt-4 py-3 rounded-xl bg-stone-800/40 border border-stone-700/40 text-stone-600 hover:text-stone-400 text-xs transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${generatingPersonal ? 'animate-spin' : ''}`} />
            Zmień profil i przegeneruj moją listę
          </button>
        ) : (
          <button
            onClick={regenerateShared}
            disabled={generatingShared}
            className="w-full flex items-center justify-center gap-2 mt-4 py-3 rounded-xl bg-stone-800/40 border border-stone-700/40 text-stone-600 hover:text-stone-400 text-xs transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${generatingShared ? 'animate-spin' : ''}`} />
            Przegeneruj wspólne propozycje AI
          </button>
        )
      )}
      </div>
      )}

      {/* Okienko dodawania — overlay na środku, przyciemnione tło */}
      {showAddForm && (
        <div
          className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-20 sm:items-center sm:pt-0 overflow-y-auto"
          onClick={() => !adding && setShowAddForm(false)}
        >
          {/* przyciemnione tło */}
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

          {/* karta */}
          <div
            onClick={e => e.stopPropagation()}
            className="relative w-full max-w-sm bg-stone-900 border border-stone-700 rounded-2xl p-5 shadow-2xl animate-in"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-base font-semibold text-stone-100">
                {view === 'personal' ? 'Dodaj do mojej listy' : 'Dodaj do wspólnych'}
              </h3>
              <button
                onClick={() => !adding && setShowAddForm(false)}
                className="text-stone-500 hover:text-stone-300 transition-colors p-1 -mr-1"
                aria-label="Zamknij"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <input
              type="text"
              value={newItemText}
              onChange={e => setNewItemText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addItem()}
              placeholder="Nazwa elementu..."
              className="w-full bg-stone-800 border border-stone-700 rounded-xl px-3 py-3 text-base text-stone-100 placeholder-stone-600 focus:outline-none focus:border-forest-500 mb-3"
              autoFocus
            />
            <select
              value={newItemCategory}
              onChange={e => setNewItemCategory(e.target.value)}
              className="w-full bg-stone-800 border border-stone-700 rounded-xl px-3 py-3 text-base text-stone-300 focus:outline-none focus:border-forest-500 mb-4"
            >
              {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <div className="flex gap-2">
              <button onClick={() => setShowAddForm(false)} className="flex-1 py-3 rounded-xl bg-stone-800 text-stone-400 text-sm font-medium">Anuluj</button>
              <button
                onClick={addItem}
                disabled={adding || !newItemText.trim()}
                className="flex-1 py-3 rounded-xl bg-forest-600 hover:bg-forest-500 disabled:bg-stone-700 text-white text-sm font-medium transition-colors"
              >
                {adding ? 'Dodaję...' : 'Dodaj'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
