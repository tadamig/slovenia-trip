import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q') || 'Slovenia travel'

  try {
    const res = await fetch(
      `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=top&limit=25&t=year`,
      {
        headers: {
          'User-Agent': 'SloveniaTripPlanner/1.0',
        },
        next: { revalidate: 3600 }, // cache 1h
      }
    )

    if (!res.ok) {
      return NextResponse.json({ posts: [] })
    }

    const data = await res.json()
    const posts = (data.data?.children || []).map((c: any) => ({
      title: c.data.title,
      score: c.data.score,
      url: c.data.permalink,
      subreddit: c.data.subreddit,
      selftext: c.data.selftext?.slice(0, 500) || '',
    }))

    return NextResponse.json({ posts })
  } catch {
    return NextResponse.json({ posts: [] })
  }
}
