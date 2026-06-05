import { NextRequest, NextResponse } from 'next/server'

// Proxy zdjęć Google Places dla Przewodnika. Pobiera obraz po photo_reference
// kluczem SERWEROWYM (nie wyciekającym do przeglądarki) i streamuje go dalej.
// Część Przewodnika (opcjonalny dodatek) — usuwalne razem z całą funkcją.
export const runtime = 'nodejs'

const GKEY = process.env.GOOGLE_PLACES_API_KEY || ''

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const ref = searchParams.get('ref') || ''
  const w = Math.min(1200, Math.max(200, parseInt(searchParams.get('w') || '800', 10) || 800))

  // photo_reference to dług ciąg [A-Za-z0-9_-], czasem ze znakami URL-safe.
  if (!GKEY || !ref || ref.length < 20 || !/^[A-Za-z0-9_\-]+$/.test(ref)) {
    return NextResponse.json({ error: 'bad ref' }, { status: 400 })
  }

  const url = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${w}&photo_reference=${ref}&key=${GKEY}`
  try {
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok || !res.body) {
      return NextResponse.json({ error: 'upstream' }, { status: 502 })
    }
    const buf = Buffer.from(await res.arrayBuffer())
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': res.headers.get('content-type') || 'image/jpeg',
        // cache na 30 dni (zdjęcia miejsc rzadko się zmieniają)
        'Cache-Control': 'public, max-age=2592000, s-maxage=2592000, immutable',
      },
    })
  } catch {
    return NextResponse.json({ error: 'fetch failed' }, { status: 502 })
  }
}
