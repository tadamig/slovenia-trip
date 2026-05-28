'use client'

import { useState, useEffect } from 'react'
import { supabase, PackingItem, Room, UserPreference } from '@/lib/supabase'
import { getSessionId, getSessionName } from '@/lib/session'
import { Plus, Check, Trash2, ChevronDown, ChevronRight } from 'lucide-react'

const CATEGORIES = [
  { id: 'sprzet', label: '🏄 Sprzęt', color: 'water' },
  { id: 'jedzenie', label: '🍖 Jedzenie', color: 'sand' },
  { id: 'dokumenty', label: '📄 Dokumenty', color: 'forest' },
  { id: 'van', label: '🚐 Van', color: 'stone' },
  { id: 'ubrania', label: '👕 Ubrania', color: 'stone' },
  { id: 'inne', label: '📦 Inne', color: 'stone' },
]

const DEFAULT_ITEMS: Omit<PackingItem, 'id' | 'room_id' | 'created_at' | 'added_by' | 'added_by_session'>[] = [
  // Sprzęt
  { category: 'sprzet', name: 'Deski SUP (x4)', checked: false },
  { category: 'sprzet', name: 'Wiosła SUP', checked: false },
  { category: 'sprzet', name: 'Pompa do SUP', checked: false },
  { category: 'sprzet', name: 'Buty trekkingowe', checked: false },
  { category: 'sprzet', name: 'Plecaki trekkingowe', checked: false },
  { category: 'sprzet', name: 'Kijki trekkingowe', checked: false },
  // Dokumenty
  { category: 'dokumenty', name: 'Dowody osobiste / paszporty', checked: false },
  { category: 'dokumenty', name: 'Ubezpieczenie samochodu', checked: false },
  { category: 'dokumenty', name: 'Karta EKUZ', checked: false },
  { category: 'dokumenty', name: 'Prawo jazdy', checked: false },
  // Van
  { category: 'van', name: 'Apteczka pierwszej pomocy', checked: false },
  { category: 'van', name: 'Kabel do ładowania 12V', checked: false },
  { category: 'van', name: 'Materace / śpiwory', checked: false },
  { category: 'van', name: 'Kuchenka turystyczna', checked: false },
  { category: 'van', name: 'Naczynia i sztućce', checked: false },
  // Ubrania
  { category: 'ubrania', name: 'Strój kąpielowy', checked: false },
  { category: 'ubrania', name: 'Odzież przeciwdeszczowa', checked: false },
  { category: 'ubrania', name: 'Ciepła bluza / kurtka na wieczór', checked: false },
]

interface Props {
  room: Room
  myPrefs: UserPreference
}

export default function PackingList({ room, myPrefs }: Props) {
  const [items, setItems] = useState<PackingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [newItemText, setNewItemText] = useState('')
  const [newItemCategory, setNewItemCategory] = useState('inne')
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const sessionId = getSessionId()

  useEffect(() => {
    loadItems()
    const channel = supabase
      .channel(`packing:${room.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'packing_items',
        filter: `room_id=eq.${room.id}`,
      }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setItems(prev => [...prev, payload.new as PackingItem])
        } else if (payload.eventType === 'UPDATE') {
          setItems(prev => prev.map(i => i.id === (payload.new as PackingItem).id ? payload.new as PackingItem : i))
        } else if (payload.eventType === 'DELETE') {
          setItems(prev => prev.filter(i => i.id !== payload.old.id))
        }
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
      // Pierwsze załadowanie — wstaw domyślne elementy
      await seedDefaultItems()
    } else {
      setItems(data || [])
    }
    setLoading(false)
  }

  async function seedDefaultItems() {
    const name = getSessionName()
    const toInsert = DEFAULT_ITEMS.map(item => ({
      ...item,
      room_id: room.id,
      added_by: 'system',
      added_by_session: 'system',
    }))
    const { data } = await supabase.from('packing_items').insert(toInsert).select()
    setItems(data || [])
  }

  async function addItem() {
    if (!newItemText.trim()) return
    setAdding(true)
    const name = getSessionName()
    const { data } = await supabase.from('packing_items').insert({
      room_id: room.id,
      category: newItemCategory,
      name: newItemText.trim(),
      checked: false,
      added_by: name,
      added_by_session: sessionId,
    }).select().single()
    if (data) setItems(prev => [...prev, data])
    setNewItemText('')
    setAdding(false)
  }

  async function toggleItem(item: PackingItem) {
    const { data } = await supabase
      .from('packing_items')
      .update({ checked: !item.checked })
      .eq('id', item.id)
      .select()
      .single()
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
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-stone-600 text-sm animate-pulse">Ładowanie listy...</div>
      </div>
    )
  }

  return (
    <div className="px-4 py-5 max-w-lg mx-auto">
      {/* Progress */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-lg font-semibold text-stone-100">Lista pakowania</h2>
        <span className="text-xs text-stone-500 bg-stone-800 px-2.5 py-1 rounded-full">
          {checkedCount} / {items.length}
        </span>
      </div>
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
            <button
              onClick={() => toggleCategory(cat.id)}
              className="w-full flex items-center justify-between py-2 group"
            >
              <div className="flex items-center gap-2">
                {collapsed ? <ChevronRight className="w-4 h-4 text-stone-600" /> : <ChevronDown className="w-4 h-4 text-stone-500" />}
                <span className="text-sm font-medium text-stone-300">{cat.label}</span>
                <span className="text-xs text-stone-600">{catChecked}/{catItems.length}</span>
              </div>
            </button>

            {!collapsed && (
              <div className="space-y-1 ml-1">
                {catItems.map(item => (
                  <div
                    key={item.id}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all ${
                      item.checked
                        ? 'bg-stone-800/20 border-stone-800 opacity-60'
                        : 'bg-stone-800/50 border-stone-700/50'
                    }`}
                  >
                    <button
                      onClick={() => toggleItem(item)}
                      className={`w-5 h-5 rounded-md border flex-shrink-0 flex items-center justify-center transition-all ${
                        item.checked
                          ? 'bg-forest-600 border-forest-600'
                          : 'border-stone-600 hover:border-forest-500'
                      }`}
                    >
                      {item.checked && <Check className="w-3 h-3 text-white" />}
                    </button>
                    <span className={`flex-1 text-sm ${item.checked ? 'line-through text-stone-600' : 'text-stone-300'}`}>
                      {item.name}
                    </span>
                    {item.added_by !== 'system' && (
                      <span className="text-stone-700 text-xs">{item.added_by}</span>
                    )}
                    <button
                      onClick={() => deleteItem(item.id)}
                      className="text-stone-700 hover:text-red-400 transition-colors p-0.5 opacity-0 group-hover:opacity-100"
                    >
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
        <button
          onClick={() => setShowAddForm(true)}
          className="w-full flex items-center gap-2 bg-stone-800/40 border border-dashed border-stone-700 hover:border-stone-600 rounded-xl px-4 py-3 text-stone-600 hover:text-stone-400 transition-all text-sm mt-2"
        >
          <Plus className="w-4 h-4" /> Dodaj element do listy
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
          <select
            value={newItemCategory}
            onChange={e => setNewItemCategory(e.target.value)}
            className="w-full bg-stone-800 border border-stone-700 rounded-xl px-3 py-2.5 text-sm text-stone-300 focus:outline-none focus:border-forest-500"
          >
            {CATEGORIES.map(c => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <button
              onClick={() => setShowAddForm(false)}
              className="flex-1 py-2.5 rounded-xl bg-stone-800 text-stone-500 text-sm"
            >
              Anuluj
            </button>
            <button
              onClick={addItem}
              disabled={adding || !newItemText.trim()}
              className="flex-1 py-2.5 rounded-xl bg-forest-600 hover:bg-forest-500 disabled:bg-stone-700 text-white text-sm font-medium transition-colors"
            >
              {adding ? 'Dodaję...' : 'Dodaj'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
