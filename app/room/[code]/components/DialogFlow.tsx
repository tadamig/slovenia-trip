'use client'

import { useState, useEffect } from 'react'
import { Room, UserPreference } from '@/lib/supabase'
import { getSessionName, setSessionName } from '@/lib/session'
import { ChevronRight, ChevronLeft, Check, Users, Compass } from 'lucide-react'

interface Props {
  room: Room
  existingPrefs: UserPreference | null
  allPrefs: UserPreference[]
  onComplete: (prefs: Partial<UserPreference>, roomUpdates?: Partial<Room>) => void
}

// ——— Dane konfiguracyjne ———
const ACTIVITIES = [
  { id: 'sup', emoji: '🏄', label: 'SUP / pływanie' },
  { id: 'trekking', emoji: '🥾', label: 'Trekking' },
  { id: 'food', emoji: '🍽️', label: 'Lokalne jedzenie' },
  { id: 'sunset', emoji: '🌅', label: 'Zachody słońca' },
  { id: 'van', emoji: '🏕️', label: 'Nocleg w vanie' },
  { id: 'sightseeing', emoji: '🏛️', label: 'Zwiedzanie miast' },
  { id: 'cycling', emoji: '🚴', label: 'Rower' },
  { id: 'relax', emoji: '🧘', label: 'Relaks / slow travel' },
  { id: 'photo', emoji: '📸', label: 'Fotografia' },
  { id: 'nightlife', emoji: '🍺', label: 'Bary / życie nocne' },
  { id: 'markets', emoji: '🛒', label: 'Lokalne targi' },
  { id: 'petfriendly', emoji: '🐾', label: 'Przyjazne zwierzętom' },
]

const INTENSITY = [
  { id: 'slow', emoji: '🐢', label: 'Spokojne tempo' },
  { id: 'balanced', emoji: '⚖️', label: 'Zbalansowane' },
  { id: 'intense', emoji: '🔥', label: 'Intensywne' },
]

const ACCOMMODATION = [
  { id: 'tent', emoji: '🏕️', label: 'Namiot / camping' },
  { id: 'van', emoji: '🚐', label: 'Van / kamper' },
  { id: 'airbnb', emoji: '🏠', label: 'Airbnb / domki' },
  { id: 'hotel', emoji: '🏨', label: 'Hotel / hostel' },
]

const FOOD = [
  { id: 'vegetarian', label: '🥦 Wegetariańskie' },
  { id: 'vegan', label: '🌱 Wegańskie' },
  { id: 'glutenfree', label: '🌾 Bez glutenu' },
  { id: 'anything', label: '🍖 Wszystko — cokolwiek lokalnego' },
]

const STEP_COUNT = 5

function GroupPreview({ allPrefs }: { allPrefs: UserPreference[] }) {
  if (allPrefs.length === 0) return null
  return (
    <div className="bg-stone-800/40 border border-stone-700/50 rounded-xl p-3 mt-4">
      <p className="text-stone-500 text-xs mb-2 flex items-center gap-1.5">
        <Users className="w-3 h-3" /> {allPrefs.length} {allPrefs.length === 1 ? 'osoba już wypełniła' : 'osoby już wypełniły'} preferencje
      </p>
      <div className="flex flex-wrap gap-1.5">
        {allPrefs.map(p => (
          <span key={p.session_id} className="bg-forest-800/50 border border-forest-700/30 text-forest-300 text-xs px-2 py-0.5 rounded-full">
            {p.user_name}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function DialogFlow({ room, existingPrefs, allPrefs, onComplete }: Props) {
  const [step, setStep] = useState(0) // 0 = welcome
  const [activities, setActivities] = useState<string[]>(existingPrefs?.activities || [])
  const [intensity, setIntensity] = useState<string>(existingPrefs?.intensity || '')
  const [accommodation, setAccommodation] = useState<string>(existingPrefs?.accommodation || '')
  const [food, setFood] = useState<string[]>(existingPrefs?.food || [])
  const [startDate, setStartDate] = useState(room.start_date || '')
  const [startCity, setStartCity] = useState(room.start_city || '')
  const [endCity, setEndCity] = useState(room.end_city || 'Ljubljana')
  const [userName, setUserNameLocal] = useState(getSessionName() !== 'Nieznajomy' ? getSessionName() : '')
  const [saving, setSaving] = useState(false)

  function toggleActivity(id: string) {
    setActivities(prev =>
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    )
  }

  function toggleFood(id: string) {
    setFood(prev =>
      prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]
    )
  }

  function canProceed(): boolean {
    if (step === 0) return userName.trim().length > 0
    if (step === 1) return activities.length > 0
    if (step === 2) return intensity !== ''
    if (step === 3) return accommodation !== ''
    if (step === 4) return food.length > 0
    return true
  }

  async function handleFinish() {
    if (!canProceed()) return
    setSaving(true)
    if (userName.trim()) setSessionName(userName.trim())
    await onComplete(
      { activities, intensity: intensity as any, accommodation: accommodation as any, food },
      { start_date: startDate || undefined, start_city: startCity, end_city: endCity }
    )
    setSaving(false)
  }

  const progressPct = ((step) / (STEP_COUNT)) * 100

  return (
    <div className="min-h-screen bg-stone-950 flex flex-col">
      {/* Header */}
      <div className="px-4 pt-8 pb-4">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Compass className="w-5 h-5 text-forest-400" />
            <span className="text-stone-400 text-xs font-medium">Pokój: <span className="font-mono text-stone-300">{room.code}</span></span>
          </div>
          <span className="text-stone-600 text-xs">{step === 0 ? 'Start' : `${step} / ${STEP_COUNT}`}</span>
        </div>

        {/* Progress bar */}
        {step > 0 && (
          <div className="h-1 bg-stone-800 rounded-full overflow-hidden mb-6">
            <div
              className="h-full bg-gradient-to-r from-forest-500 to-water-500 rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 px-4 pb-24 overflow-y-auto">
        <div className="max-w-sm mx-auto animate-fade-up">

          {/* KROK 0 — Welcome + imię */}
          {step === 0 && (
            <div className="space-y-6">
              <div>
                <h1 className="font-display text-3xl font-bold text-stone-50 mb-2">
                  Witaj w planowaniu! 🏔️
                </h1>
                <p className="text-stone-400 text-sm leading-relaxed">
                  Zanim zaczniesz przeglądać rekomendacje i mapę — powiedz nam czegoś o sobie i preferencjach. Zajmie to 2 minuty.
                </p>
              </div>

              <div>
                <label className="text-xs text-stone-500 font-medium block mb-2">Twoje imię w tej ekipie</label>
                <input
                  type="text"
                  value={userName}
                  onChange={e => setUserNameLocal(e.target.value)}
                  placeholder="np. Kasia, Marek..."
                  className="w-full bg-stone-800 border border-stone-700 rounded-xl px-4 py-3.5 text-stone-100 placeholder-stone-600 focus:outline-none focus:border-forest-500 transition-colors text-sm"
                  maxLength={20}
                  autoFocus
                />
              </div>

              {room.trip_name && (
                <div className="bg-stone-800/40 border border-stone-700/40 rounded-xl p-4 flex items-center gap-3">
                  <span className="text-2xl">🚐</span>
                  <div>
                    <p className="text-stone-300 text-sm font-medium">{room.trip_name}</p>
                    <p className="text-stone-600 text-xs mt-0.5">Trasa: Budapeszt → Słowenia</p>
                  </div>
                </div>
              )}

              <GroupPreview allPrefs={allPrefs} />
            </div>
          )}

          {/* KROK 1 — Aktywności */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h2 className="font-display text-2xl font-bold text-stone-50 mb-1">
                  Co chcesz robić?
                </h2>
                <p className="text-stone-500 text-xs">Wybierz wszystko co cię kręci. Możesz wybrać kilka.</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {ACTIVITIES.map(act => {
                  const selected = activities.includes(act.id)
                  return (
                    <button
                      key={act.id}
                      onClick={() => toggleActivity(act.id)}
                      className={`flex items-center gap-2.5 px-3 py-3.5 rounded-xl border text-left transition-all duration-150 active:scale-95 ${
                        selected
                          ? 'bg-forest-600/20 border-forest-500 text-forest-300'
                          : 'bg-stone-800/60 border-stone-700 text-stone-400 hover:border-stone-600'
                      }`}
                    >
                      <span className="text-xl">{act.emoji}</span>
                      <span className="text-xs font-medium leading-tight">{act.label}</span>
                      {selected && <Check className="w-3.5 h-3.5 text-forest-400 ml-auto flex-shrink-0" />}
                    </button>
                  )
                })}
              </div>
              {activities.length > 0 && (
                <p className="text-forest-400 text-xs text-center">
                  Wybrano: {activities.length} {activities.length === 1 ? 'aktywność' : 'aktywności'}
                </p>
              )}
            </div>
          )}

          {/* KROK 2 — Intensywność */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="font-display text-2xl font-bold text-stone-50 mb-1">
                  Jakie tempo?
                </h2>
                <p className="text-stone-500 text-xs">Jedno z trzech — nie ma złej odpowiedzi.</p>
              </div>
              <div className="space-y-2.5">
                {INTENSITY.map(opt => {
                  const selected = intensity === opt.id
                  return (
                    <button
                      key={opt.id}
                      onClick={() => setIntensity(opt.id)}
                      className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl border text-left transition-all duration-150 active:scale-[0.98] ${
                        selected
                          ? 'bg-water-600/15 border-water-500 text-water-300'
                          : 'bg-stone-800/60 border-stone-700 text-stone-400 hover:border-stone-600'
                      }`}
                    >
                      <span className="text-3xl">{opt.emoji}</span>
                      <span className="font-medium text-sm">{opt.label}</span>
                      {selected && <Check className="w-4 h-4 text-water-400 ml-auto" />}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* KROK 3 — Nocleg */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h2 className="font-display text-2xl font-bold text-stone-50 mb-1">
                  Gdzie śpisz?
                </h2>
                <p className="text-stone-500 text-xs">Noclegowa strategia ekipy.</p>
              </div>
              <div className="space-y-2.5">
                {ACCOMMODATION.map(opt => {
                  const selected = accommodation === opt.id
                  return (
                    <button
                      key={opt.id}
                      onClick={() => setAccommodation(opt.id)}
                      className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl border text-left transition-all duration-150 active:scale-[0.98] ${
                        selected
                          ? 'bg-sand-600/15 border-sand-500 text-sand-300'
                          : 'bg-stone-800/60 border-stone-700 text-stone-400 hover:border-stone-600'
                      }`}
                    >
                      <span className="text-3xl">{opt.emoji}</span>
                      <span className="font-medium text-sm">{opt.label}</span>
                      {selected && <Check className="w-4 h-4 text-sand-400 ml-auto" />}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* KROK 4 — Jedzenie */}
          {step === 4 && (
            <div className="space-y-5">
              <div>
                <h2 className="font-display text-2xl font-bold text-stone-50 mb-1">
                  Jak z jedzeniem?
                </h2>
                <p className="text-stone-500 text-xs">Możesz wybrać kilka opcji.</p>
              </div>
              <div className="space-y-2">
                {FOOD.map(opt => {
                  const selected = food.includes(opt.id)
                  return (
                    <button
                      key={opt.id}
                      onClick={() => toggleFood(opt.id)}
                      className={`w-full flex items-center justify-between px-5 py-4 rounded-2xl border text-left transition-all duration-150 active:scale-[0.98] ${
                        selected
                          ? 'bg-forest-600/15 border-forest-500 text-forest-300'
                          : 'bg-stone-800/60 border-stone-700 text-stone-400 hover:border-stone-600'
                      }`}
                    >
                      <span className="font-medium text-sm">{opt.label}</span>
                      {selected && <Check className="w-4 h-4 text-forest-400" />}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* KROK 5 — Data i trasa */}
          {step === 5 && (
            <div className="space-y-5">
              <div>
                <h2 className="font-display text-2xl font-bold text-stone-50 mb-1">
                  Kiedy i skąd?
                </h2>
                <p className="text-stone-500 text-xs">Ostatni krok — data i logistyka trasy.</p>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-stone-500 font-medium block mb-1.5">Data wyjazdu</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                    className="w-full bg-stone-800 border border-stone-700 rounded-xl px-4 py-3.5 text-stone-100 focus:outline-none focus:border-forest-500 transition-colors text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-stone-500 font-medium block mb-1.5">Miasto startowe</label>
                  <input
                    type="text"
                    value={startCity}
                    onChange={e => setStartCity(e.target.value)}
                    placeholder="np. Kraków, Warszawa, Wrocław..."
                    className="w-full bg-stone-800 border border-stone-700 rounded-xl px-4 py-3.5 text-stone-100 placeholder-stone-600 focus:outline-none focus:border-forest-500 transition-colors text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-stone-500 font-medium block mb-1.5">Docelowe miasto / region końcowy</label>
                  <input
                    type="text"
                    value={endCity}
                    onChange={e => setEndCity(e.target.value)}
                    placeholder="np. Ljubljana, Bled, Triglav..."
                    className="w-full bg-stone-800 border border-stone-700 rounded-xl px-4 py-3.5 text-stone-100 placeholder-stone-600 focus:outline-none focus:border-forest-500 transition-colors text-sm"
                  />
                </div>
              </div>

              {/* Podsumowanie preferencji */}
              <div className="bg-stone-800/40 border border-stone-700/40 rounded-2xl p-4 space-y-3">
                <p className="text-stone-400 text-xs font-semibold uppercase tracking-wider">Twoje preferencje</p>
                <div className="flex flex-wrap gap-1.5">
                  {activities.map(id => {
                    const act = ACTIVITIES.find(a => a.id === id)
                    return act ? (
                      <span key={id} className="bg-forest-800/40 text-forest-300 text-xs px-2.5 py-1 rounded-full border border-forest-700/30">
                        {act.emoji} {act.label}
                      </span>
                    ) : null
                  })}
                </div>
                <div className="flex gap-2 text-xs text-stone-500">
                  <span>{INTENSITY.find(i => i.id === intensity)?.emoji} {INTENSITY.find(i => i.id === intensity)?.label}</span>
                  <span>·</span>
                  <span>{ACCOMMODATION.find(a => a.id === accommodation)?.emoji} {ACCOMMODATION.find(a => a.id === accommodation)?.label}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom nav */}
      <div className="fixed bottom-0 left-0 right-0 bg-stone-950/90 backdrop-blur-sm border-t border-stone-800 px-4 py-4">
        <div className="max-w-sm mx-auto flex gap-3">
          {step > 0 && (
            <button
              onClick={() => setStep(s => s - 1)}
              className="flex items-center gap-1.5 px-4 py-3 rounded-xl bg-stone-800 border border-stone-700 text-stone-400 hover:text-stone-200 transition-colors text-sm"
            >
              <ChevronLeft className="w-4 h-4" /> Wróć
            </button>
          )}

          <button
            onClick={() => {
              if (step < STEP_COUNT) setStep(s => s + 1)
              else handleFinish()
            }}
            disabled={!canProceed() || saving}
            className={`flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl font-semibold text-sm transition-all duration-200 active:scale-[0.98] ${
              canProceed() && !saving
                ? 'bg-forest-600 hover:bg-forest-500 text-white'
                : 'bg-stone-800 text-stone-600 cursor-not-allowed'
            }`}
          >
            {saving ? (
              'Zapisuję...'
            ) : step < STEP_COUNT ? (
              <>Dalej <ChevronRight className="w-4 h-4" /></>
            ) : (
              <>Zaczynam planować! <Check className="w-4 h-4" /></>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
