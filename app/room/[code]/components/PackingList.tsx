'use client'

import { useState, useEffect } from 'react'
import { supabase, PackingItem, Room, UserPreference } from '@/lib/supabase'
import { getSessionId, getSessionName } from '@/lib/session'
import { Plus, Check, Trash2, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'

const CATEGORIES = [
  { id: 'sprzet', label: '🏄 Sprzęt' },
  { id: 'nocleg', label: '🏕️ Nocleg' },
  { id: 'ubrania', label: '👕 Ubrania' },
  { id: 'jedzenie', label: '🍖 Jedzenie' },
  { id: 'dokumenty', label: '📄 Dokumenty' },
  { id: 'inne', label: '📦 Inne' },
]

// Baza elementów powiązana z aktywnościami i noclegiem
type ItemDef = {
  category: string
  name: string
  activities?: string[]   // pokaż jeśli ekipa wybrała DOWOLNĄ z tych aktywności
  accommodation?: string[] // pokaż jeśli nocleg pasuje
  always?: boolean         // zawsze pokaż
}

const ITEM_DATABASE: ItemDef[] = [
  // ——— ZAWSZE ———
  { category: 'dokumenty', name: 'Dowody osobiste / paszporty', always: true },
  { category: 'dokumenty', name: 'Karta EKUZ (ubezpieczenie EU)', always: true },
  { category: 'dokumenty', name: 'Prawo jazdy', always: true },
  { category: 'dokumenty', name: 'Ubezpieczenie samochodu (OC/AC)', always: true },
  { category: 'dokumenty', name: 'Aplikacja z mapami offline (Maps.me)', always: true },
  { category: 'inne', name: 'Powerbank', always: true },
  { category: 'inne', name: 'Adapter do gniazdek (jeśli potrzebny)', always: true },
  { category: 'inne', name: 'Apteczka pierwszej pomocy', always: true },
  { category: 'ubrania', name: 'Odzież przeciwdeszczowa / ponczo', always: true },
  { category: 'ubrania', name: 'Ciepła bluza / polar na wieczór', always: true },
  { category: 'ubrania', name: 'Strój kąpielowy', always: true },
  { category: 'ubrania', name: 'Wygodne buty na co dzień', always: true },
  { category: 'inne', name: 'Krem z filtrem SPF 50+', always: true },

  // ——— SUP ———
  { category: 'sprzet', name: 'Deski SUP (nadmuchiwane)', activities: ['sup'] },
  { category: 'sprzet', name: 'Wiosła SUP', activities: ['sup'] },
  { category: 'sprzet', name: 'Pompa do SUP (elektryczna lub ręczna)', activities: ['sup'] },
  { category: 'sprzet', name: 'Smycze do desek SUP', activities: ['sup'] },
  { category: 'sprzet', name: 'Kamizelki asekuracyjne', activities: ['sup'] },
  { category: 'sprzet', name: 'Wodoodporny worek / dry bag', activities: ['sup'] },
  { category: 'sprzet', name: 'Buty do wody (neoprenowe)', activities: ['sup'] },
  { category: 'ubrania', name: 'Pianka neoprenowa (jeśli zimna woda)', activities: ['sup'] },
  { category: 'inne', name: 'Wodoodporna obudowa na telefon', activities: ['sup'] },

  // ——— TREKKING ———
  { category: 'sprzet', name: 'Buty trekkingowe (za kostkę)', activities: ['trekking'] },
  { category: 'sprzet', name: 'Plecak trekkingowy 20-30L', activities: ['trekking'] },
  { category: 'sprzet', name: 'Kijki trekkingowe', activities: ['trekking'] },
  { category: 'sprzet', name: 'Mapa / GPX tras (Mapy.cz)', activities: ['trekking'] },
  { category: 'sprzet', name: 'Czołówka z zapasowymi bateriami', activities: ['trekking'] },
  { category: 'ubrania', name: 'Getry / długie spodnie trekkingowe', activities: ['trekking'] },
  { category: 'inne', name: 'Płyn na komary i kleszcze', activities: ['trekking'] },
  { category: 'inne', name: 'Plastry i bandaże na otarcia', activities: ['trekking'] },

  // ——— ROWER ———
  { category: 'sprzet', name: 'Rowery / e-bike', activities: ['cycling'] },
  { category: 'sprzet', name: 'Kask rowerowy', activities: ['cycling'] },
  { category: 'sprzet', name: 'Zapięcie rowerowe / U-lock', activities: ['cycling'] },
  { category: 'sprzet', name: 'Pompka rowerowa + łatki', activities: ['cycling'] },
  { category: 'sprzet', name: 'Uchwyt na telefon do kierownicy', activities: ['cycling'] },

  // ——— FOTO ———
  { category: 'sprzet', name: 'Statyw fotograficzny', activities: ['photo', 'sunset'] },
  { category: 'sprzet', name: 'Dodatkowe baterie do aparatu', activities: ['photo'] },
  { category: 'sprzet', name: 'Karty pamięci (zapasowe)', activities: ['photo'] },
  { category: 'inne', name: 'Filtr ND do zdjęć wody', activities: ['photo', 'sup'] },

  // ——— JEDZENIE ———
  { category: 'jedzenie', name: 'Kuchenka turystyczna + gaz', activities: ['food', 'markets'] },
  { category: 'jedzenie', name: 'Naczynia i sztućce turystyczne', activities: ['food'] },
  { category: 'jedzenie', name: 'Deska do krojenia + nóż', activities: ['food'] },
  { category: 'jedzenie', name: 'Torba termiczna / lodówka samochodowa', activities: ['food'] },
  { category: 'jedzenie', name: 'Pojemniki na żywność', activities: ['food'] },
  { category: 'jedzenie', name: 'Lokalne przyprawy (zioła itp.)', activities: ['food', 'markets'] },

  // ——— NOCLEG: NAMIOT ———
  { category: 'nocleg', name: 'Namiot (+ śledzie, miotełka)', accommodation: ['tent'] },
  { category: 'nocleg', name: 'Śpiwory (sezonowe)', accommodation: ['tent'] },
  { category: 'nocleg', name: 'Mata izolacyjna / karimat', accommodation: ['tent'] },
  { category: 'nocleg', name: 'Kuchenka turystyczna + gaz', accommodation: ['tent'] },
  { category: 'nocleg', name: 'Latarka + świeczki', accommodation: ['tent'] },
  { category: 'nocleg', name: 'Sznurek do rozwieszania prania', accommodation: ['tent'] },

  // ——— NOCLEG: VAN / KAMPER ———
  { category: 'nocleg', name: 'Materace / poduszki', accommodation: ['van'] },
  { category: 'nocleg', name: 'Śpiwory lub kołdry', accommodation: ['van'] },
  { category: 'nocleg', name: 'Zasłony / rolety na szyby', accommodation: ['van'] },
  { category: 'nocleg', name: 'Kabel zasilający 12V', accommodation: ['van'] },
  { category: 'nocleg', name: 'Przenośna toaleta / shovel', accommodation: ['van'] },
  { category: 'nocleg', name: 'Pojemnik na wodę (20L)', accommodation: ['van'] },

  // ——— NOCLEG: AIRBNB / DOMKI ———
  { category: 'nocleg', name: 'Kłódka na bagaż', accommodation: ['airbnb'] },
  { category: 'nocleg', name: 'Ręczniki (własne, na wszelki wypadek)', accommodation: ['airbnb'] },

  // ——— NOCLEG: HOTEL / HOSTEL ———
  { category: 'nocleg', name: 'Kłódka do szafki w hostelu', accommodation: ['hotel'] },
  { category: 'nocleg', name: 'Zatyczki do uszu', accommodation: ['hotel'] },
  { category: 'nocleg', name: 'Maska na oczy do spania', accommodation: ['hotel'] },
]

function buildSmartList(activities: string[], accommodation: string): ItemDef[] {
  return ITEM_DATABASE.filter(item => {
    if (item.always) return true
    if (item.activities && item.activities.some(a => activities.includes(a))) return true
    if (item.accommodation && item.accommodation.includes(accommodation)) return true
    return false
  })
}

interface Props {
  room: Room
  myPrefs: UserPreference
  allPrefs?: UserPreference[]
}

export default function PackingList({ room, myPrefs, allPrefs = [] }: Props) {
  const [items, setItems] = useState<PackingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [newItemText, setNewItemText] = useState('')
  const [newItemCategory, setNewItemCategory] = useState('inne')
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [reseeding, setReseeding] = useState(false)
  const sessionId = getSessionId()

  // Agreguj aktywności z ekipy (większość głosów) + nocleg z mojego profilu
  const groupActivities = (() => {
    const completed = allPrefs.filter(p => p.completed)
    if (completed.length === 0) return myPrefs.activities || []
    const counts: Record<string, number> = {}
    completed.forEach(p => (p.activities || []).forEach(a => { counts[a] = (counts[a] || 0) + 1 }))
    return Object.entries(counts).filter(([, c]) => c >= 1).map(([id]) => id)
  })()

  const accommodation = myPrefs.accommodation || 'hotel'

  useEffect(() => {
    loadItems()
    const channel = supabase
      .channel(`packing:${room.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'packing_items',
        filter: `room_id=eq.${room.id}`,
      }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const incoming = payload.new as PackingItem
          setItems(prev => prev.some(i => i.id === incoming.id) ? prev : [...prev, incoming])
        }
        else if (payload.eventType === 'UPDATE') setItems(prev => prev.map(i => i.id === (payload.new as PackingItem).id ? payload.new as PackingItem : i))
        else if (payload.eventType === 'DELETE') setItems(prev => prev.filter(i => i.id !== payload.old.id))
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [room.id])

  async function loadItems() {
    setLoading(true)
    const { data } = await supabase
      .from('packing_items')
      .select('*')
      .eq('room_id', room.id)
      .order('created_at', { ascending: true })

    if (data && data.length === 0) {
      await seedItems()
    } else {
      setItems(data || [])
    }
    setLoading(false)
  }

  async function seedItems() {
    const smartList = buildSmartList(groupActivities, accommodation)
    const toInsert = smartList.map(item => ({
      category: item.category,
      name: item.name,
      checked: false,
      room_id: room.id,
      added_by: 'system',
      added_by_session: 'system',
    }))
    const { data } = await supabase.from('packing_items').insert(toInsert).select()
    setItems(data || [])
  }

  async function handleReseed() {
    if (!confirm('Resetuje listę i generuję nową na podstawie aktualnych preferencji ekipy. Stracisz ręczne zmiany. Na pewno?')) return
    setReseeding(true)
    await supabase.from('packing_items').delete().eq('room_id', room.id)
    await seedItems()
    setReseeding(false)
  }

  async function addItem() {
    if (!newItemText.trim()) return
    setAdding(true)
    const { data } = await supabase.from('packing_items').insert({
      room_id: room.id,
      category: newItemCategory,
      name: newItemText.trim(),
      checked: false,
      added_by: getSessionName(),
      added_by_session: sessionId,
    }).select().single()
    if (data) setItems(prev => [...prev, data])
    setNewItemText('')
    setAdding(false)
  }

  async function toggleItem(item: PackingItem) {
    const { data } = await supabase
      .from('packing_items').update({ checked: !item.checked }).eq('id', item.id).select().single()
    if (data) setItems(prev => prev.map(i => i.id === item.id ? data : i))
  }

  async function deleteItem(id: string) {
    await supabase.from('packing_items').delete().eq('id', id)
    setItems(prev => prev.filter(i => i.id !== id))
  }

  function toggleCategory(cat: string) {
    setCollapsedCats(prev => {
      const next = new Set(prev)
      next.has(cat) ? next.delete(cat) : next.add(cat)
      return next
    })
  }

  const checkedCount = items.filter(i => i.checked).length

  if (loading) {
    return <div className="flex items-center justify-center py-16 text-stone-600 text-sm animate-pulse">Generuję listę dla ekipy...</div>
  }

  return (
    <div className="px-4 py-5 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-display text-lg font-semibold text-stone-100">Lista pakowania</h2>
        <span className="text-xs text-stone-500 bg-stone-800 px-2.5 py-1 rounded-full">{checkedCount} / {items.length}</span>
      </div>

      {/* Aktywne filtry */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {groupActivities.slice(0, 5).map(a => (
          <span key={a} className="text-xs bg-forest-800/40 text-forest-400 border border-forest-700/30 px-2 py-0.5 rounded-full">{a}</span>
        ))}
        <span className="text-xs bg-stone-800 text-stone-500 border border-stone-700/30 px-2 py-0.5 rounded-full">{accommodation}</span>
      </div>

      {/* Progress */}
      <div className="h-1.5 bg-stone-800 rounded-full overflow-hidden mb-5">
        <div
          className="h-full bg-gradient-to-r from-forest-500 to-water-500 rounded-full transition-all duration-500"
          style={{ width: items.length ? `${(checkedCount / items.length) * 100}%` : '0%' }}
        />
      </div>

      {/* Categories */}
      {CATEGORIES.map(cat => {
        const catItems = items.filter(i => i.category === cat.id)
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
                  <div key={item.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all group ${item.checked ? 'bg-stone-800/20 border-stone-800 opacity-50' : 'bg-stone-800/50 border-stone-700/50'}`}>
                    <button
                      onClick={() => toggleItem(item)}
                      className={`w-5 h-5 rounded-md border flex-shrink-0 flex items-center justify-center transition-all ${item.checked ? 'bg-forest-600 border-forest-600' : 'border-stone-600 hover:border-forest-500'}`}
                    >
                      {item.checked && <Check className="w-3 h-3 text-white" />}
                    </button>
                    <span className={`flex-1 text-sm ${item.checked ? 'line-through text-stone-600' : 'text-stone-300'}`}>{item.name}</span>
                    {item.added_by !== 'system' && <span className="text-stone-700 text-xs">{item.added_by}</span>}
                    <button onClick={() => deleteItem(item.id)} className="text-stone-700 hover:text-red-400 transition-colors p-0.5 opacity-0 group-hover:opacity-100">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {/* Add item */}
      {!showAddForm ? (
        <button onClick={() => setShowAddForm(true)} className="w-full flex items-center gap-2 bg-stone-800/40 border border-dashed border-stone-700 hover:border-stone-600 rounded-xl px-4 py-3 text-stone-600 hover:text-stone-400 transition-all text-sm mt-2">
          <Plus className="w-4 h-4" /> Dodaj element
        </button>
      ) : (
        <div className="bg-stone-900 border border-stone-700 rounded-2xl p-4 space-y-3 mt-2">
          <input
            type="text"
            value={newItemText}
            onChange={e => setNewItemText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addItem()}
            placeholder="Nazwa elementu..."
            className="w-full bg-stone-800 border border-stone-700 rounded-xl px-3 py-2.5 text-sm text-stone-100 placeholder-stone-600 focus:outline-none focus:border-forest-500"
            autoFocus
          />
          <select value={newItemCategory} onChange={e => setNewItemCategory(e.target.value)} className="w-full bg-stone-800 border border-stone-700 rounded-xl px-3 py-2.5 text-sm text-stone-300 focus:outline-none focus:border-forest-500">
            {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <div className="flex gap-2">
            <button onClick={() => setShowAddForm(false)} className="flex-1 py-2.5 rounded-xl bg-stone-800 text-stone-500 text-sm">Anuluj</button>
            <button onClick={addItem} disabled={adding || !newItemText.trim()} className="flex-1 py-2.5 rounded-xl bg-forest-600 hover:bg-forest-500 disabled:bg-stone-700 text-white text-sm font-medium transition-colors">
              {adding ? 'Dodaję...' : 'Dodaj'}
            </button>
          </div>
        </div>
      )}

      {/* Regenerate button */}
      <button
        onClick={handleReseed}
        disabled={reseeding}
        className="w-full flex items-center justify-center gap-2 mt-4 py-3 rounded-xl bg-stone-800/40 border border-stone-700/40 text-stone-600 hover:text-stone-400 text-xs transition-all"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${reseeding ? 'animate-spin' : ''}`} />
        {reseeding ? 'Generuję...' : 'Regeneruj listę wg preferencji ekipy'}
      </button>
    </div>
  )
}
