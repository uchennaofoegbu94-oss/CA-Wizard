import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import ReactMarkdown from 'react-markdown'
import {
  Plus, Loader2, Newspaper, Pencil, Trash2, Eye, ImagePlus,
  ExternalLink, Globe, FileEdit, Clock, Tag as TagIcon
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { logAudit } from '@/lib/audit'
import { uploadBlogCoverImage } from '@/lib/storage'
import { slugify, formatDate, formatDateTime } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader, EmptyState, Spinner } from '@/components/ui/table'
import { FormField, FormGrid } from '@/components/ui/form-field'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/dialog'
import toast from 'react-hot-toast'
import type { BlogPost } from '@/types'

const postSchema = z.object({
  title: z.string().min(4, 'Title must be at least 4 characters'),
  slug: z.string().min(3, 'Slug must be at least 3 characters').regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers, and hyphens only'),
  excerpt: z.string().max(280, 'Keep the excerpt under 280 characters').optional(),
  content: z.string().min(20, 'Write a bit more content'),
  tags: z.string().optional(),
  metaDescription: z.string().max(160, 'Keep it under 160 characters for search results').optional()
})
type PostFormData = z.infer<typeof postSchema>

const parseTags = (raw?: string): string[] =>
  (raw ?? '').split(',').map(t => t.trim()).filter(Boolean)

export default function BlogPostsPage() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [editing, setEditing] = useState<BlogPost | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [coverPreview, setCoverPreview] = useState<string | null>(null)
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [uploadingCover, setUploadingCover] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<BlogPost | null>(null)
  const [slugTouched, setSlugTouched] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [scheduleTarget, setScheduleTarget] = useState<BlogPost | null>(null)
  const [scheduleDateTime, setScheduleDateTime] = useState('')

  const { register, handleSubmit, watch, setValue, reset, formState: { errors, isSubmitting } } = useForm<PostFormData>({
    resolver: zodResolver(postSchema)
  })
  const title = watch('title')
  const content = watch('content')

  const { data: posts = [], isLoading } = useQuery({
    queryKey: ['blog-posts-admin'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('blog_posts')
        .select('*, author:profiles(*)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as BlogPost[]
    }
  })

  const invalidateAll = () => qc.invalidateQueries({ queryKey: ['blog-posts-admin'] })

  const openCreate = () => {
    setEditing(null)
    setCoverPreview(null)
    setCoverFile(null)
    setSlugTouched(false)
    reset({ title: '', slug: '', excerpt: '', content: '', tags: '', metaDescription: '' })
    setDialogOpen(true)
  }

  const openEdit = (post: BlogPost) => {
    setEditing(post)
    setCoverPreview(post.cover_image_url)
    setCoverFile(null)
    setSlugTouched(true)
    reset({
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt ?? '',
      content: post.content,
      tags: (post.tags ?? []).join(', '),
      metaDescription: post.meta_description ?? ''
    })
    setDialogOpen(true)
  }

  const handleTitleChange = (value: string) => {
    setValue('title', value)
    if (!slugTouched) setValue('slug', slugify(value))
  }

  const handleCoverSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setCoverFile(file)
    setCoverPreview(URL.createObjectURL(file))
  }

  // ── Create / update ──────────────────────────────────────────
  const savePost = useMutation({
    mutationFn: async (data: PostFormData) => {
      let coverUrl = editing?.cover_image_url ?? null
      const tags = parseTags(data.tags)

      if (editing) {
        const { error } = await supabase
          .from('blog_posts')
          .update({
            title: data.title,
            slug: data.slug,
            excerpt: data.excerpt || null,
            content: data.content,
            tags,
            meta_description: data.metaDescription || null
          })
          .eq('id', editing.id)
        if (error) throw error

        if (coverFile) {
          setUploadingCover(true)
          const { url, error: upErr } = await uploadBlogCoverImage(editing.id, coverFile)
          setUploadingCover(false)
          if (upErr) throw new Error(upErr)
          coverUrl = url
          await supabase.from('blog_posts').update({ cover_image_url: coverUrl }).eq('id', editing.id)
        }
        return editing.id
      } else {
        const { data: row, error } = await supabase
          .from('blog_posts')
          .insert({
            author_id: profile!.id,
            title: data.title,
            slug: data.slug,
            excerpt: data.excerpt || null,
            content: data.content,
            tags,
            meta_description: data.metaDescription || null
          })
          .select()
          .single()
        if (error) throw error

        if (coverFile) {
          setUploadingCover(true)
          const { url, error: upErr } = await uploadBlogCoverImage(row.id, coverFile)
          setUploadingCover(false)
          if (!upErr && url) {
            await supabase.from('blog_posts').update({ cover_image_url: url }).eq('id', row.id)
          }
        }
        return row.id as string
      }
    },
    onSuccess: (id) => {
      logAudit({
        schoolId: null,
        userId: profile?.id ?? null,
        action: editing ? 'UPDATE' : 'CREATE',
        entityType: 'blog_post',
        entityId: id,
        newValue: { title }
      })
      toast.success(editing ? 'Post updated' : 'Post created as draft')
      setDialogOpen(false)
      invalidateAll()
    },
    onError: (err: Error) => toast.error(err.message.includes('duplicate') ? 'That slug is already taken' : err.message)
  })

  // ── Publish now / unpublish ────────────────────────────────────
  const togglePublish = useMutation({
    mutationFn: async (post: BlogPost) => {
      const publishing = post.status !== 'published'
      const { error } = await supabase
        .from('blog_posts')
        .update({
          status: publishing ? 'published' : 'draft',
          published_at: publishing ? new Date().toISOString() : post.published_at
        })
        .eq('id', post.id)
      if (error) throw error
      return publishing
    },
    onSuccess: (publishing, post) => {
      logAudit({ schoolId: null, userId: profile?.id ?? null, action: 'UPDATE', entityType: 'blog_post', entityId: post.id, newValue: { status: publishing ? 'published' : 'draft' } })
      toast.success(publishing ? 'Post published' : 'Post unpublished')
      invalidateAll()
    },
    onError: (err: Error) => toast.error(err.message)
  })

  // ── Schedule for a future time ──────────────────────────────────
  // Same 'published' status as an immediate publish — the public RLS
  // policy (028) also requires published_at <= NOW(), so a future
  // published_at simply stays invisible until that time arrives. No
  // cron/worker needed.
  const schedulePost = useMutation({
    mutationFn: async ({ post, when }: { post: BlogPost; when: string }) => {
      const { error } = await supabase
        .from('blog_posts')
        .update({ status: 'published', published_at: new Date(when).toISOString() })
        .eq('id', post.id)
      if (error) throw error
    },
    onSuccess: (_data, { post, when }) => {
      logAudit({ schoolId: null, userId: profile?.id ?? null, action: 'UPDATE', entityType: 'blog_post', entityId: post.id, newValue: { scheduled_for: when } })
      toast.success('Post scheduled')
      setScheduleOpen(false)
      setScheduleTarget(null)
      invalidateAll()
    },
    onError: (err: Error) => toast.error(err.message)
  })

  // ── Delete ──────────────────────────────────────────────────
  const deletePost = useMutation({
    mutationFn: async (post: BlogPost) => {
      const { error } = await supabase.from('blog_posts').delete().eq('id', post.id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Post deleted')
      setDeleteTarget(null)
      invalidateAll()
    },
    onError: (err: Error) => toast.error(err.message)
  })

  return (
    <div>
      <PageHeader
        title="Blog"
        description="Single-author for now — posts you write here show up at /blog once published"
        action={
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> New Post
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : posts.length === 0 ? (
        <EmptyState
          icon={<Newspaper className="h-10 w-10" />}
          title="No posts yet"
          description="Write your first post — it saves as a draft until you publish it."
          action={<Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" /> New Post</Button>}
        />
      ) : (
        <div className="space-y-2">
          {posts.map(post => {
            const isScheduled = post.status === 'published' && post.published_at && new Date(post.published_at) > new Date()
            return (
            <Card key={post.id}>
              <CardContent className="p-4 flex items-center gap-4">
                {post.cover_image_url ? (
                  <img src={post.cover_image_url} alt="" className="h-14 w-20 rounded-md object-cover shrink-0" />
                ) : (
                  <div className="h-14 w-20 rounded-md bg-muted flex items-center justify-center shrink-0">
                    <Newspaper className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium truncate">{post.title}</p>
                    <Badge variant={isScheduled ? 'warning' : post.status === 'published' ? 'success' : 'secondary'}>
                      {isScheduled ? 'Scheduled' : post.status === 'published' ? 'Published' : 'Draft'}
                    </Badge>
                    {post.tags?.map(tag => (
                      <Badge key={tag} variant="outline" className="text-xs font-normal">
                        <TagIcon className="mr-1 h-2.5 w-2.5" />{tag}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    /blog/{post.slug} ·{' '}
                    {isScheduled
                      ? `Scheduled for ${formatDateTime(post.published_at!)}`
                      : post.status === 'published' && post.published_at
                        ? `Published ${formatDate(post.published_at)}`
                        : `Created ${formatDate(post.created_at)}`}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {post.status === 'published' && !isScheduled && (
                    <Button variant="ghost" size="icon" title="View live" asChild>
                      <a href={`/blog/${post.slug}`} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  )}
                  {post.status !== 'published' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Schedule for later"
                      onClick={() => { setScheduleTarget(post); setScheduleDateTime(''); setScheduleOpen(true) }}
                    >
                      <Clock className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    title={post.status === 'published' ? 'Unpublish' : 'Publish now'}
                    onClick={() => togglePublish.mutate(post)}
                    disabled={togglePublish.isPending}
                  >
                    {post.status === 'published' ? <FileEdit className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
                  </Button>
                  <Button variant="ghost" size="icon" title="Edit" onClick={() => openEdit(post)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" title="Delete" onClick={() => setDeleteTarget(post)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
            )
          })}
        </div>
      )}

      {/* ── Create / Edit ─────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Post' : 'New Post'}</DialogTitle>
            <DialogDescription>{editing ? 'Changes save immediately — publish status is separate.' : "Saves as a draft first; publish it when you're ready."}</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit(d => savePost.mutate(d))} className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="h-20 w-32 rounded-md bg-muted overflow-hidden flex items-center justify-center shrink-0">
                {coverPreview ? (
                  <img src={coverPreview} alt="" className="h-full w-full object-cover" />
                ) : (
                  <ImagePlus className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
              <div>
                <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploadingCover}>
                  {uploadingCover ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="mr-2 h-3.5 w-3.5" />}
                  {coverPreview ? 'Replace cover image' : 'Add cover image'}
                </Button>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleCoverSelect} />
                <p className="text-xs text-muted-foreground mt-1">Optional. Shows on the blog list and post header.</p>
              </div>
            </div>

            <FormField label="Title" required error={errors.title?.message} htmlFor="post-title">
              <Input id="post-title" value={title ?? ''} onChange={e => handleTitleChange(e.target.value)} placeholder="Post title" />
            </FormField>

            <FormField label="Slug" required error={errors.slug?.message} htmlFor="post-slug">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground shrink-0">/blog/</span>
                <Input
                  id="post-slug"
                  {...register('slug')}
                  onChange={e => { setSlugTouched(true); setValue('slug', e.target.value) }}
                  placeholder="post-slug"
                />
              </div>
            </FormField>

            <FormField label="Excerpt" error={errors.excerpt?.message} htmlFor="post-excerpt">
              <Textarea id="post-excerpt" rows={2} placeholder="Short summary shown on the blog list (optional)" {...register('excerpt')} />
            </FormField>

            <FormGrid cols={2}>
              <FormField label="Tags" htmlFor="post-tags">
                <Input id="post-tags" placeholder="e.g. product, tips (comma-separated)" {...register('tags')} />
              </FormField>
              <FormField label="Meta Description" error={errors.metaDescription?.message} htmlFor="post-meta">
                <Input id="post-meta" placeholder="For search engines (optional)" {...register('metaDescription')} />
              </FormField>
            </FormGrid>

            <FormField label="Content (Markdown)" required error={errors.content?.message} htmlFor="post-content">
              <Textarea id="post-content" rows={12} className="font-mono text-sm" placeholder="Write in Markdown — headings, **bold**, lists, links…" {...register('content')} />
            </FormField>

            <Button type="button" variant="outline" size="sm" onClick={() => setPreviewOpen(true)} disabled={!content}>
              <Eye className="mr-2 h-3.5 w-3.5" /> Preview
            </Button>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting || savePost.isPending || uploadingCover}>
                {savePost.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? 'Save Changes' : 'Create Draft'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Preview ────────────────────────────────────────────── */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{title || 'Untitled'}</DialogTitle>
          </DialogHeader>
          <article className="prose prose-sm max-w-none dark:prose-invert">
            <ReactMarkdown>{content || ''}</ReactMarkdown>
          </article>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Schedule ───────────────────────────────────────────── */}
      <Dialog open={scheduleOpen} onOpenChange={(o) => { setScheduleOpen(o); if (!o) setScheduleTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule "{scheduleTarget?.title}"</DialogTitle>
            <DialogDescription>It publishes automatically the moment someone loads the blog after this time — no action needed from you.</DialogDescription>
          </DialogHeader>
          <FormField label="Publish at" htmlFor="schedule-datetime">
            <Input
              id="schedule-datetime"
              type="datetime-local"
              min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
              value={scheduleDateTime}
              onChange={e => setScheduleDateTime(e.target.value)}
            />
          </FormField>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleOpen(false)}>Cancel</Button>
            <Button
              disabled={!scheduleDateTime || schedulePost.isPending}
              onClick={() => scheduleTarget && schedulePost.mutate({ post: scheduleTarget, when: scheduleDateTime })}
            >
              {schedulePost.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Schedule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm ────────────────────────────────────── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone{deleteTarget?.status === 'published' ? ' — the live page at /blog/' + deleteTarget?.slug + ' will 404 immediately' : ''}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTarget && deletePost.mutate(deleteTarget)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
