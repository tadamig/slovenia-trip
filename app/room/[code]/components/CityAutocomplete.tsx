'use client'

import { useState, useEffect, useRef } from 'react'
import { MapPin, X } from 'lucide-react'

interface Prediction {
  placeId: string
  description: string
  mainText: string
  secondaryText: string
}

interface Props {
  value: string
  onChange: (city: string, country: string, fullDescription: string) => void
  placeholder?: string
  label?: string
}

export default function CityAutocomplete({ value, onChange, placeholder, label }: Props) {
  const [input, setInput] = useState(value)
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setInput(value)
  }, [value])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function handleInput(val: string) {
    setInput(val)
    clearTimeout(debounceRef.current)

    if (val.length < 2) {
      setPredictions([])
      setOpen(false)
      return
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/autocomplete?input=${encodeURIComponent(val)}`)
        if (res.ok) {
          const data = await res.json()
          setPredictions(data.predictions || [])
          setOpen(true)
        }
      } catch {}
      setLoading(false)
    }, 300)
  }

  function handleSelect(p: Prediction) {
    // Wyciągnij kraj z secondaryText (ostatni element po przecinku)
    const parts = p.description.split(', ')
    const country = parts[parts.length - 1] || ''
    setInput(p.mainText)
    setOpen(false)
    setPredictions([])
    onChange(p.mainText, country, p.description)
  }

  function handleClear() {
    setInput('')
    setPredictions([])
    setOpen(false)
    onChange('', '', '')
  }

  return (
    <div ref={containerRef} className="relative">
      {label && <label className="text-xs text-stone-500 font-medium block mb-1.5">{label}</label>}
      <div className="relative">
        <input
          type="text"
          value={input}
          onChange={e => handleInput(e.target.value)}
          onFocus={() => predictions.length > 0 && setOpen(true)}
          placeholder={placeholder}
          className="w-full bg-stone-800 border border-stone-700 rounded-xl px-4 py-3.5 text-stone-100 placeholder-stone-600 focus:outline-none focus:border-forest-500 transition-colors text-sm pr-10"
        />
        {input && (
          <button onClick={handleClear} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-500 hover:text-stone-300">
            <X className="w-4 h-4" />
          </button>
        )}
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-forest-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {open && predictions.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-stone-800 border border-stone-700 rounded-xl overflow-hidden shadow-xl">
          {predictions.map(p => (
            <button
              key={p.placeId}
              onClick={() => handleSelect(p)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-stone-700 transition-colors text-left border-b border-stone-700/50 last:border-0"
            >
              <MapPin className="w-4 h-4 text-forest-500 flex-shrink-0" />
              <div>
                <p className="text-stone-100 text-sm font-medium">{p.mainText}</p>
                {p.secondaryText && (
                  <p className="text-stone-500 text-xs">{p.secondaryText}</p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
