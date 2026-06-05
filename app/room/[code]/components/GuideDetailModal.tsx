'use client'

// Overlay „Więcej o miejscu" dla Przewodnika. Pobiera /api/guide-detail (zdjęcia
// Google + szczegóły + blogi + AI-tipy), pokazuje slider zdjęć i sekcje.
// Część Przewodnika — usuwalne razem z całą funkcją (skasuj plik + użycie w GuideTab).

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Navigation, MapPin, Star, Globe, Phone, Clock, ChevronLeft, ChevronRight, Lightbulb, Mountain, Wallet, BookOpen, ExternalLink } from 'lucide-react'

type Review = { author: string; rating: number | null; when: string; text: string }
type Details = {
  photos: string[]
  google: {
    price_txt?: string | null; website?: string | null; phone?: string | null
    hours?: string[] | null; editorial?: string | null; rating?: number | null
    total?: number | null; maps_url?: string | null; reviews?: Review[]
  }
  blogs: { title: string; url: string; snippet: string }[]
  ai: { cena?: string | null; czas?: string | null; trasa?: string | null; trudnosc?: string | null; tipy?: string[] }
  pdf_more?: string | null
}
export type GuideFallback = {
  id: string; name: string; category: string; description: string | null
  lat: number | null; lon: number | null; google_rating: number | null; google_total_ratings: number | null
}

const navUrl = (lat: number, lon: number) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`
const viewUrl = (name: string, lat: number, lon: number) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}%20${lat},${lon}`
const photoUrl = (ref: string) => `/api/guide-photo?ref=${encodeURIComponent(ref)}&w=900`

export default function GuideDetailModal({
  place, dist, catLabel, catEmoji, onClose,
}: {
  place: GuideFallback
  dist: number | null
  catLabel: string
  catEmoji: string
  onClose: () => void
}) {
  const [det, setDet] = useState<Details | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(false)
  const [hoursOpen, setHoursOpen] = useState(false)
  const sliderRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancel = false
    setLoading(true); setErr(false)
    fetch(`/api/guide-detail?id=${place.id}`)
      .then((r) => r.json())
      .then((d) => { if (!cancel) { setDet(d.details || null); setLoading(false) } })
      .catch(() => { if (!cancel) { setErr(true); setLoading(false) } })
    return () => { cancel = true }
  }, [place.id])

  // zablokuj scroll tła
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  const scroll = (dir: number) => {
    const el = sliderRef.current
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' })
  }

  const g = det?.google || {}
  const ai = det?.ai || {}
  const photos = det?.photos || []
  const rating = g.rating ?? place.google_rating
  const total = g.total ?? place.google_total_ratings
  const isTrail = place.category === 'trail'
  const hasAi = !!(ai.cena || ai.czas || ai.trasa || ai.trudnosc || (ai.tipy && ai.tipy.length))

  const overlay = (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-stone-900 w-full sm:max-w-lg max-h-[92vh] rounded-t-2xl sm:rounded-2xl flex flex-col overflow-hidden border border-stone-700/50 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Nagłówek — zawsze widoczny (X nie chowa się przy przewijaniu) */}
        <div className="flex-shrink-0 bg-stone-900 px-4 py-3 border-b border-stone-800 flex items-start gap-2">
          <span className="text-xl flex-shrink-0">{catEmoji}</span>
          <div className="flex-1 min-w-0">
            <h3 className="text-stone-100 font-semibold leading-tight">{place.name}</h3>
            <div className="flex items-center gap-2 mt-0.5 text-[11px] text-stone-500 flex-wrap">
              <span>{catLabel}</span>
              {rating != null && rating > 0 && (
                <span className="text-amber-400 flex items-center gap-0.5"><Star className="w-3 h-3" /> {rating}{total ? ` (${total})` : ''}</span>
              )}
              {dist != null && <span className="text-water-400">{dist < 10 ? dist.toFixed(1) : Math.round(dist)} km</span>}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-stone-500 hover:text-stone-200 hover:bg-stone-800 flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Korpus przewijany (nagłówek zostaje na górze) */}
        <div className="overflow-y-auto overscroll-contain flex-1">
        {/* Slider zdjęć */}
        {loading ? (
          <div className="h-52 bg-stone-800/50 animate-pulse" />
        ) : photos.length > 0 ? (
          <div className="relative group bg-black">
            <div ref={sliderRef} className="flex overflow-x-auto snap-x snap-mandatory scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
              {photos.map((ref, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={photoUrl(ref)}
                  alt={`${place.name} ${i + 1}`}
                  loading={i === 0 ? 'eager' : 'lazy'}
                  className="w-full flex-shrink-0 snap-center h-52 sm:h-60 object-cover"
                  draggable={false}
                />
              ))}
            </div>
            {photos.length > 1 && (
              <>
                <button onClick={() => scroll(-1)} className="absolute left-1 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/50 text-white hover:bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity">
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button onClick={() => scroll(1)} className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/50 text-white hover:bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity">
                  <ChevronRight className="w-5 h-5" />
                </button>
                <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1">
                  {photos.map((_, i) => <span key={i} className="w-1.5 h-1.5 rounded-full bg-white/60" />)}
                </div>
              </>
            )}
          </div>
        ) : null}

        <div className="px-4 py-4 space-y-4">
          {/* Opis z poradnika */}
          {place.description && (
            <p className="text-stone-300 text-sm leading-relaxed">{place.description}</p>
          )}
          {g.editorial && (
            <p className="text-stone-400 text-xs leading-relaxed italic">{g.editorial}</p>
          )}

          {/* Trekking: trasa / czas / trudność */}
          {isTrail && (ai.czas || ai.trasa || ai.trudnosc) && (
            <div className="rounded-xl bg-forest-900/20 border border-forest-800/40 p-3">
              <p className="text-forest-300 text-xs font-semibold flex items-center gap-1.5 mb-1.5"><Mountain className="w-3.5 h-3.5" /> Trasa</p>
              <div className="space-y-1 text-xs text-stone-300">
                {ai.trasa && <p><span className="text-stone-500">Charakter:</span> {ai.trasa}</p>}
                {ai.czas && <p><span className="text-stone-500">Czas:</span> {ai.czas}</p>}
                {ai.trudnosc && <p><span className="text-stone-500">Trudność:</span> {ai.trudnosc}</p>}
              </div>
            </div>
          )}

          {/* Czas zwiedzania (nie-trekking) */}
          {!isTrail && ai.czas && (
            <p className="text-xs text-stone-300 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-stone-500" /> <span className="text-stone-500">Ile czasu:</span> {ai.czas}</p>
          )}

          {/* Cena */}
          {(ai.cena || g.price_txt) && (
            <p className="text-xs text-stone-300 flex items-start gap-1.5"><Wallet className="w-3.5 h-3.5 text-stone-500 mt-0.5 flex-shrink-0" /> <span><span className="text-stone-500">Koszt:</span> {ai.cena || g.price_txt}</span></p>
          )}

          {/* Tipy */}
          {ai.tipy && ai.tipy.length > 0 && (
            <div>
              <p className="text-amber-300 text-xs font-semibold flex items-center gap-1.5 mb-1.5"><Lightbulb className="w-3.5 h-3.5" /> Tipy</p>
              <ul className="space-y-1">
                {ai.tipy.map((t, i) => (
                  <li key={i} className="text-xs text-stone-300 flex gap-1.5"><span className="text-amber-500/70">•</span> {t}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Kontakt / godziny */}
          {(g.website || g.phone || (g.hours && g.hours.length)) && (
            <div className="space-y-1.5 text-xs">
              {g.website && (
                <a href={g.website} target="_blank" rel="noopener noreferrer" className="text-water-400 hover:text-water-300 flex items-center gap-1.5 truncate">
                  <Globe className="w-3.5 h-3.5 flex-shrink-0" /> <span className="truncate">{g.website.replace(/^https?:\/\//, '')}</span>
                </a>
              )}
              {g.phone && (
                <a href={`tel:${g.phone}`} className="text-stone-300 hover:text-stone-100 flex items-center gap-1.5"><Phone className="w-3.5 h-3.5 flex-shrink-0" /> {g.phone}</a>
              )}
              {g.hours && g.hours.length > 0 && (
                <div>
                  <button onClick={() => setHoursOpen((v) => !v)} className="text-stone-400 hover:text-stone-200 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 flex-shrink-0" /> Godziny otwarcia {hoursOpen ? '▲' : '▼'}
                  </button>
                  {hoursOpen && (
                    <div className="mt-1 pl-5 space-y-0.5 text-stone-500">
                      {g.hours.map((h, i) => <p key={i}>{h}</p>)}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Recenzje Google */}
          {g.reviews && g.reviews.length > 0 && (
            <div>
              <p className="text-stone-400 text-xs font-semibold mb-1.5">Z recenzji Google</p>
              <div className="space-y-2">
                {g.reviews.map((rv, i) => (
                  <div key={i} className="rounded-lg bg-stone-800/40 border border-stone-700/30 p-2.5">
                    <div className="flex items-center gap-2 text-[11px] text-stone-500 mb-1">
                      <span className="text-stone-300 font-medium">{rv.author}</span>
                      {rv.rating != null && <span className="text-amber-400 flex items-center gap-0.5"><Star className="w-2.5 h-2.5" /> {rv.rating}</span>}
                      {rv.when && <span>· {rv.when}</span>}
                    </div>
                    <p className="text-xs text-stone-400 leading-relaxed">{rv.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Blogi */}
          {det?.blogs && det.blogs.length > 0 && (
            <div>
              <p className="text-stone-400 text-xs font-semibold flex items-center gap-1.5 mb-1.5"><BookOpen className="w-3.5 h-3.5" /> Z blogów i sieci</p>
              <div className="space-y-1.5">
                {det.blogs.map((b, i) => (
                  <a key={i} href={b.url} target="_blank" rel="noopener noreferrer" className="block rounded-lg bg-stone-800/40 border border-stone-700/30 p-2.5 hover:border-water-700/50 transition-colors">
                    <p className="text-water-300 text-xs font-medium flex items-center gap-1 truncate"><ExternalLink className="w-3 h-3 flex-shrink-0" /> <span className="truncate">{b.title}</span></p>
                    {b.snippet && <p className="text-stone-500 text-[11px] mt-0.5 leading-snug line-clamp-2">{b.snippet}</p>}
                  </a>
                ))}
              </div>
            </div>
          )}

          {loading && (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => <div key={i} className="h-4 bg-stone-800/40 rounded animate-pulse" style={{ width: `${90 - i * 12}%` }} />)}
            </div>
          )}
          {err && <p className="text-stone-500 text-xs text-center py-2">Nie udało się pobrać szczegółów. Spróbuj ponownie.</p>}
          {!loading && !err && !hasAi && photos.length === 0 && !(g.reviews?.length) && !(det?.blogs?.length) && (
            <p className="text-stone-600 text-xs text-center py-2">Brak dodatkowych materiałów dla tego miejsca.</p>
          )}

          {/* Akcje */}
          {place.lat != null && place.lon != null && (
            <div className="flex items-center gap-2 pt-1">
              <a href={navUrl(place.lat, place.lon)} target="_blank" rel="noopener noreferrer" className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-water-700/30 border border-water-700/40 text-water-200 text-xs font-medium hover:border-water-500/60 transition-colors">
                <Navigation className="w-3.5 h-3.5" /> Nawiguj
              </a>
              <a href={g.maps_url || viewUrl(place.name, place.lat, place.lon)} target="_blank" rel="noopener noreferrer" className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-stone-800 border border-stone-700/50 text-stone-300 text-xs font-medium hover:text-stone-100 transition-colors">
                <MapPin className="w-3.5 h-3.5" /> Google Maps
              </a>
            </div>
          )}

          {/* Atrybucja źródeł */}
          {!loading && (hasAi || (det?.blogs?.length ?? 0) > 0) && (
            <p className="text-[10px] text-stone-600 leading-snug pt-1">
              Podsumowanie opracowane na podstawie poradnika, danych Google i wyników z sieci. Tipy/czas/cena mogą być uproszczone — zweryfikuj na miejscu.
            </p>
          )}
        </div>
        </div>
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(overlay, document.body) : null
}
