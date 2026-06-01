// ——————————————————————————————————————————————
// Abstrakcja wyszukiwania webowego (do offline ingestu blogów).
//
// Jedyne miejsce zależne od dostawcy. Dziś: Google Custom Search JSON API.
// Google CSE jest wygaszany dla nowych klientów (migracja do Vertex AI Search
// do ~2027) — gdy przyjdzie czas, podmieniamy WYŁĄCZNIE implementację
// `searchWeb` poniżej; reszta pipeline'u (ingest) zostaje bez zmian.
//
// Env (placeholdery — wartości wklejasz w Vercel):
//   GOOGLE_CSE_KEY  — klucz API (Programmable Search Engine / Custom Search)
//   GOOGLE_CSE_CX   — identyfikator wyszukiwarki (cx)
// ——————————————————————————————————————————————

export type WebResult = {
  title: string
  url: string
  snippet: string
}

const GOOGLE_CSE_KEY = (process.env.GOOGLE_CSE_KEY || '').trim()
const GOOGLE_CSE_CX = (process.env.GOOGLE_CSE_CX || '').trim()

export function isSearchConfigured(): boolean {
  return Boolean(GOOGLE_CSE_KEY && GOOGLE_CSE_CX)
}

/**
 * Zwraca listę wyników web search (tytuł + URL + snippet).
 * Best-effort: przy braku konfiguracji lub błędzie zwraca [].
 *
 * @param query  zapytanie (np. "best SUP lakes near Bled blog")
 * @param limit  ile wyników (Google CSE: max 10 na zapytanie)
 */
export async function searchWeb(query: string, limit = 8): Promise<WebResult[]> {
  if (!isSearchConfigured() || !query.trim()) return []
  const num = Math.max(1, Math.min(10, limit))
  try {
    const url =
      `https://www.googleapis.com/customsearch/v1` +
      `?key=${encodeURIComponent(GOOGLE_CSE_KEY)}` +
      `&cx=${encodeURIComponent(GOOGLE_CSE_CX)}` +
      `&q=${encodeURIComponent(query)}` +
      `&num=${num}`
    const res = await fetch(url)
    if (!res.ok) return []
    const data = await res.json()
    const items = Array.isArray(data.items) ? data.items : []
    return items
      .map((it: any): WebResult => ({
        title: String(it?.title || '').trim(),
        url: String(it?.link || '').trim(),
        snippet: String(it?.snippet || '').trim(),
      }))
      .filter((r: WebResult) => r.url)
  } catch {
    return []
  }
}
