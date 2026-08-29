import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { GraduationCap, ArrowLeft, Newspaper, Calendar, Tag as TagIcon } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/table'
import type { BlogPost } from '@/types'

export default function BlogPage() {
  const { data: posts = [], isLoading } = useQuery({
    queryKey: ['public-blog-posts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('blog_posts')
        .select('id, title, slug, excerpt, cover_image_url, published_at, tags')
        .eq('status', 'published')
        .order('published_at', { ascending: false })
      if (error) throw error
      return data as Pick<BlogPost, 'id' | 'title' | 'slug' | 'excerpt' | 'cover_image_url' | 'published_at' | 'tags'>[]
    }
  })

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
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to home
          </Link>
        </div>
      </header>

      <div className="container py-12 max-w-3xl">
        <h1 className="text-3xl font-bold">Blog</h1>
        <p className="text-muted-foreground mt-2">Updates, tips, and news from the CA-Wizard team.</p>

        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner size="lg" /></div>
        ) : posts.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
            <Newspaper className="h-10 w-10" />
            <p>Nothing here yet — check back soon.</p>
          </div>
        ) : (
          <div className="mt-8 space-y-8">
            {posts.map(post => (
              <Link key={post.id} to={`/blog/${post.slug}`} className="block group">
                <article className="flex flex-col sm:flex-row gap-4 sm:items-start">
                  {post.cover_image_url && (
                    <img
                      src={post.cover_image_url}
                      alt=""
                      className="w-full sm:w-48 h-32 rounded-lg object-cover shrink-0"
                    />
                  )}
                  <div className="min-w-0">
                    <h2 className="text-xl font-semibold group-hover:text-primary transition-colors">{post.title}</h2>
                    {post.published_at && (
                      <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
                        <Calendar className="h-3 w-3" /> {formatDate(post.published_at)}
                      </p>
                    )}
                    {post.excerpt && <p className="text-sm text-muted-foreground mt-2 line-clamp-3">{post.excerpt}</p>}
                    {post.tags && post.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {post.tags.map(tag => (
                          <Badge key={tag} variant="outline" className="text-xs font-normal">
                            <TagIcon className="mr-1 h-2.5 w-2.5" />{tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </article>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
