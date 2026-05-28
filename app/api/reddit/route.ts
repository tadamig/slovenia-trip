import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

type RedditPost = {
  title: string
  score: number
  url: string
  subreddit: string
  text: string
  numComments: number
}

type FetchStats = {
  source: string
  ok: boolean
  status?: number
  error?: string
  count: number
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function normalizePost(raw: any): RedditPost | null {
  if (!raw?.data?.title || !raw?.data?.permalink) return null
  return {
    title: raw.data.title,
    score: typeof raw.data.score === 'number' ? raw.data.score : 0,
    url: `https://reddit.com${raw.data.permalink}`,
    subreddit: raw.data.subreddit || 'unknown',
    text: (raw.data.selftext || '').slice(0, 500),
    numComments: typeof raw.data.num_comments === 'number' ? raw.data.num_comments : 0,
  }
}

async function fetchRedditQuery(
  query: string,
  sort: string,
  limit: number,
  time: string,
): Promise<{ posts: RedditPost[]; stats: FetchStats[] }> {
  const sources = [
    'https://www.reddit.com/search.json',
    'https://old.reddit.com/search.json',
  ]
  const stats: FetchStats[] = []

  for (const source of sources) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    try {
      const res = await fetch(
        `${source}?q=${encodeURIComponent(query)}&sort=${sort}&limit=${limit}&t=${time}`,
        {
          headers: {
            'User-Agent': 'TripPlannerBot/1.0 (+https://vercel.app)',
            Accept: 'application/json',
          },
          signal: controller.signal,
          cache: 'no-store',
        },
      )

      if (!res.ok) {
        stats.push({ source, ok: false, status: res.status, count: 0 })
        continue
      }

      const data = await res.json()
      const posts = asArray<any>(data?.data?.children)
        .map(normalizePost)
        .filter(Boolean) as RedditPost[]

      stats.push({ source, ok: true, status: res.status, count: posts.length })
      if (posts.length > 0) return { posts, stats }
    } catch (error) {
      stats.push({ source, ok: false, count: 0, error: String(error) })
    } finally {
      clearTimeout(timeout)
    }
  }

  return { posts: [], stats }
}

function dedupeAndRank(posts: RedditPost[]) {
  const seen = new Set<string>()
  const unique: RedditPost[] = []

  for (const post of posts) {
    if (seen.has(post.url)) continue
    seen.add(post.url)
    unique.push(post)
  }

  return unique
    .filter((p) => p.score >= 0)
    .sort((a, b) => {
      if (b.numComments !== a.numComments) return b.numComments - a.numComments
      if (b.score !== a.score) return b.score - a.score
      return b.title.length - a.title.length
    })
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q') || 'Slovenia travel'
  const sort = searchParams.get('sort') || 'relevance'
  const limit = Math.min(Number(searchParams.get('limit') || 15), 25)
  const time = searchParams.get('t') || 'year'

  const { posts, stats } = await fetchRedditQuery(query, sort, limit, time)
  return NextResponse.json({
    posts: dedupeAndRank(posts),
    meta: { query, stats, sourceCount: posts.length },
  })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const queries = asArray<string>(body.queries).filter((q) => typeof q === 'string' && q.trim())
    const sort = typeof body.sort === 'string' ? body.sort : 'relevance'
    const time = typeof body.time === 'string' ? body.time : 'year'
    const limitPerQueryRaw = typeof body.limitPerQuery === 'number' ? body.limitPerQuery : 12
    const limitPerQuery = Math.max(5, Math.min(limitPerQueryRaw, 20))

    if (queries.length === 0) {
      return NextResponse.json({ posts: [], queriesTried: 0 })
    }

    const cappedQueries = queries.slice(0, 20)
    const allPosts: RedditPost[] = []
    const fetchStats: FetchStats[] = []

    for (let i = 0; i < cappedQueries.length; i += 4) {
      const batch = cappedQueries.slice(i, i + 4)
      const results = await Promise.allSettled(
        batch.map((q) => fetchRedditQuery(q, sort, limitPerQuery, time)),
      )
      for (const result of results) {
        if (result.status !== 'fulfilled') continue
        allPosts.push(...result.value.posts)
        fetchStats.push(...result.value.stats)
      }
    }

    const ranked = dedupeAndRank(allPosts).slice(0, 80)
    return NextResponse.json({
      posts: ranked,
      queriesTried: cappedQueries.length,
      meta: {
        rawPosts: allPosts.length,
        uniquePosts: ranked.length,
        fetchStats,
      },
    })
  } catch (error) {
    return NextResponse.json({
      posts: [],
      queriesTried: 0,
      error: String(error),
    })
  }
}
