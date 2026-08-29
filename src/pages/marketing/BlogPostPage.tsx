import { useEffect, useState } from 'react'
import { useParams, Link, Navigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import { GraduationCap, ArrowLeft, Calendar, Tag as TagIcon, ThumbsUp, Heart, Lightbulb } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatDate, fullName, getVisitorToken } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/table'
import type { BlogPost, BlogReactionType, BlogPostReaction } from '@/types'

const REACTIONS: { type: BlogReactionType; icon: typeof ThumbsUp; label: string }[] = [
  { type: 'like', icon: ThumbsUp, label: 'Like' },
  { type: 'love', icon: Heart, label: 'Love' },
  { type: 'insightful', icon: Lightbulb, label: 'Insightful' }
]

// Reactions instead of comments — a fixed, small set of emoji with no
// free-text field at all, so there's nothing to moderate and nothing
// to spam with content. No login required, matching the rest of the
// public blog; a visitor is identified by an opaque token in their own
// browser (getVisitorToken), not a real account — a soft, honor-system
// dedup appropriate for a "like button," not a security boundary.
function BlogReactions({ postId }: { postId: string }) {
  const qc = useQueryClient()
  const [visitorToken] = useState(getVisitorToken)

  const { data: reactions = [] } = useQuery({
    queryKey: ['blog-reactions', postId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('blog_post_reactions')
        .select('*')
        .eq('post_id', postId)
      if (error) throw error
      return data as BlogPostReaction[]
    }
  })

  const counts = reactions.reduce<Record<string, number>>((acc, r) => {
    acc[r.reaction] = (acc[r.reaction] ?? 0) + 1
    return acc
  }, {})
  const myReactions = new Set(reactions.filter(r => r.visitor_token === visitorToken).map(r => r.reaction))

  const toggle = useMutation({
    mutationFn: async (type: BlogReactionType) => {
      if (myReactions.has(type)) {
        const { error } = await supabase
          .from('blog_post_reactions')
          .delete()
          .eq('post_id', postId)
          .eq('visitor_token', visitorToken)
          .eq('reaction', type)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('blog_post_reactions')
          .insert({ post_id: postId, visitor_token: visitorToken, reaction: type })
        if (error) throw error
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['blog-reactions', postId] })
  })

  return (
    <div className="flex items-center gap-2 mt-8 pt-6 border-t">
      {REACTIONS.map(({ type, icon: Icon, label }) => {
        const active = myReactions.has(type)
        const count = counts[type] ?? 0
        return (
          <button
            key={type}
            type="button"
            onClick={() => toggle.mutate(type)}
            disabled={toggle.isPending}
            title={label}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${
              active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/50'
            }`}
          >
            <Icon className={`h-3.5 w-3.5 ${active ? 'fill-current' : ''}`} />
            {count > 0 && <span>{count}</span>}
          </button>
        )
      })}
    </div>
  )
}

// Sets document title + meta tags for search engines and social
// previews, then restores the previous title on unmount — no new
// dependency (react-helmet etc.) for what's a handful of DOM writes
// on a page that's already client-rendered.
function useDocumentSEO(post: BlogPost | null | undefined) {
  useEffect(() => {
    if (!post) return
    const previousTitle = document.title
    document.title = `${post.title} — CA-Wizard Blog`

    const description = post.meta_description || post.excerpt || post.title
    const setMeta = (attr: 'name' | 'property', key: string, content: string) => {
      let el = document.querySelector(`meta[${attr}="${key}"]`)
      if (!el) {
        el = document.createElement('meta')
        el.setAttribute(attr, key)
        document.head.appendChild(el)
      }
      el.setAttribute('content', content)
    }

    setMeta('name', 'description', description)
    setMeta('property', 'og:title', post.title)
    setMeta('property', 'og:description', description)
    setMeta('property', 'og:type', 'article')
    if (post.cover_image_url) setMeta('property', 'og:image', post.cover_image_url)
    setMeta('name', 'twitter:card', post.cover_image_url ? 'summary_large_image' : 'summary')

    return () => {
      document.title = previousTitle
    }
  }, [post])
}

export default function BlogPostPage() {
  const { slug } = useParams<{ slug: string }>()

  const { data: post, isLoading, isError } = useQuery({
    queryKey: ['public-blog-post', slug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('blog_posts')
        .select('*, author:profiles(*)')
        .eq('slug', slug!)
        .eq('status', 'published')
        .maybeSingle()
      if (error) throw error
      return data as BlogPost | null
    },
    enabled: !!slug
  })

  // "More posts" sidebar — every other published post, newest first.
  // Deliberately not capped tightly (20, not 5) since these render as
  // small thumbnail rows, not big cards — a long scrollable list reads
  // fine here, and a low cap would make the sidebar feel emptier than
  // the actual blog is once there are more than a handful of posts.
  const { data: otherPosts = [] } = useQuery({
    queryKey: ['public-blog-other-posts', slug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('blog_posts')
        .select('id, title, slug, cover_image_url, published_at')
        .eq('status', 'published')
        .neq('slug', slug!)
        .order('published_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return data as Pick<BlogPost, 'id' | 'title' | 'slug' | 'cover_image_url' | 'published_at'>[]
    },
    enabled: !!slug
  })

  useDocumentSEO(post)

  if (!isLoading && (isError || post === null)) {
    return <Navigate to="/blog" replace />
  }

  return (
    <div className="min-h-screen bg-background bg-dot-pattern">
      <header className="border-b border-border/60">
        <div className="container flex items-center justify-between py-4">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <div className="h-7 w-7 rounded-md bg-primary flex items-center justify-center">
              <GraduationCap className="h-4 w-4 text-primary-foreground" />
            </div>
            CA-Wizard
          </Link>
          <Link to="/blog" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to blog
          </Link>
        </div>
      </header>

      {isLoading ? (
        <div className="flex justify-center py-24"><Spinner size="lg" /></div>
      ) : post ? (
        <div className="container py-12 grid lg:grid-cols-3 gap-12">
          <article className="lg:col-span-2 max-w-2xl">
            {post.cover_image_url && (
              <img src={post.cover_image_url} alt="" className="w-full h-64 rounded-xl object-cover mb-8" />
            )}
            <h1 className="text-3xl font-bold">{post.title}</h1>
            <p className="text-sm text-muted-foreground mt-2 flex items-center gap-2 flex-wrap">
              {post.author && <span>{fullName(post.author)}</span>}
              {post.published_at && (
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" /> {formatDate(post.published_at)}
                </span>
              )}
            </p>
            <div className="prose prose-neutral dark:prose-invert max-w-none mt-8">
              <ReactMarkdown>{post.content}</ReactMarkdown>
            </div>
            {post.tags && post.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-8 pt-6 border-t">
                {post.tags.map(tag => (
                  <Badge key={tag} variant="secondary">
                    <TagIcon className="mr-1 h-3 w-3" />{tag}
                  </Badge>
                ))}
              </div>
            )}
            <BlogReactions postId={post.id} />
          </article>

          {otherPosts.length > 0 && (
            <aside className="lg:col-span-1">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">More Posts</h2>
              <div className="space-y-4">
                {otherPosts.map(p => (
                  <Link key={p.id} to={`/blog/${p.slug}`} className="flex gap-3 group">
                    {p.cover_image_url ? (
                      <img src={p.cover_image_url} alt="" className="h-16 w-20 rounded-md object-cover shrink-0" />
                    ) : (
                      <div className="h-16 w-20 rounded-md bg-muted shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                        {p.title}
                      </p>
                      {p.published_at && (
                        <p className="text-xs text-muted-foreground mt-1">{formatDate(p.published_at)}</p>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </aside>
          )}
        </div>
      ) : null}
    </div>
  )
}
