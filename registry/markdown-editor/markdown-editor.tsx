"use client"

// Boring UI registry: markdown-editor. Tiptap 3 (MIT core + StarterKit + @tiptap/markdown, no Pro extensions)
// renders the buffer of @boring/viewers' useMarkdownDocument; the hook owns revisions, saving, proposals and
// the agent's tools (markdown_read_document, markdown_propose_patch, ...). The editor emits only on the person's
// own edits, so a document that is opened and not touched is never rewritten (round-trip fidelity).
import { useEffect, useRef, useState } from "react"
import { EditorContent, useEditor, useEditorState } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { Markdown } from "@tiptap/markdown"
import { Placeholder } from "@tiptap/extensions"
import { TaskItem, TaskList } from "@tiptap/extension-list"
import { Bold, Code, Heading1, Heading2, Italic, List, ListChecks, ListOrdered, Lock, Quote, Save, Strikethrough } from "lucide-react"
import type { FileProvider } from "@boring/files/web"
import { useMarkdownDocument, type AgentBinding, type Effect } from "@boring/viewers"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { ConflictBanner } from "@/components/conflict-banner"
import { ProposalDiff } from "@/components/proposal-diff"
import { cn } from "@/lib/utils"

export type MarkdownEditorProps = {
  files: FileProvider
  /** `/workspace/notes/plan.md` */
  address: string
  readOnly?: boolean
  /** The chat's client and thread: the document's tools become the agent's. */
  agent?: AgentBinding
  effect?: Effect
  placeholder?: string
  className?: string
  /** The person's selection as `get_selection` sees it, whenever it changes (null when nothing is selected). */
  onSelection?: (selection: { from: number; to: number; text: string } | null) => void
}

export function MarkdownEditor({ files, address, readOnly, agent, effect, placeholder = "Start writing…", className, onSelection }: MarkdownEditorProps) {
  const { state, actions } = useMarkdownDocument({ files, address, readOnly, agent, effect })
  // The host may show what the person selected (a chat's context): the same selection the agent's get_selection reads.
  useEffect(() => { onSelection?.(state.selection) }, [state.selection])
  const [raw, setRaw] = useState(false)
  const lastEmitted = useRef<string | null>(null)
  const interacted = useRef(false)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder }),
      Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
    ],
    content: "",
    editable: !state.readOnly,
    editorProps: { attributes: { class: "boring-prose mx-auto max-w-[72ch] px-8 py-6 focus:outline-none min-h-[240px]" } },
    onUpdate: ({ editor: e }) => {
      // Tiptap also fires while it settles on mount; only the person's own edits reach the buffer.
      if (!(e.isFocused || interacted.current)) return
      const markdown = e.getMarkdown()
      lastEmitted.current = markdown
      actions.edit(markdown)
    },
    onSelectionUpdate: ({ editor: e }) => {
      const { from, to } = e.state.selection
      actions.select(to > from ? { from, to, text: e.state.doc.textBetween(from, to, "\n") } : null)
    },
  }, [address])

  // The buffer changed from outside the editor (load, an accepted proposal, a reload): show it.
  useEffect(() => {
    if (!editor || editor.isDestroyed || state.status !== "ready") return
    if (state.buffer === lastEmitted.current) return
    editor.commands.setContent(state.buffer, { contentType: "markdown", emitUpdate: false })
    lastEmitted.current = state.buffer
  }, [editor, state.buffer, state.status])
  useEffect(() => { editor?.setEditable(!state.readOnly) }, [editor, state.readOnly])

  // go_to_heading: scroll to the n-th heading the hook parsed, and put the caret there.
  useEffect(() => {
    if (!editor || !state.navigation) return
    const target = editor.view.dom.querySelectorAll("h1, h2, h3, h4, h5, h6")[state.navigation.heading.index] as HTMLElement | undefined
    if (!target) return
    target.scrollIntoView({ block: "start", behavior: "smooth" })
    target.setAttribute("data-boring-flash", "")
    const timer = setTimeout(() => target.removeAttribute("data-boring-flash"), 1200)
    return () => clearTimeout(timer)
  }, [editor, state.navigation])

  const marks = useEditorState({ editor, selector: ({ editor: e }) => e ? { bold: e.isActive("bold"), italic: e.isActive("italic"), strike: e.isActive("strike"), code: e.isActive("code"), h1: e.isActive("heading", { level: 1 }), h2: e.isActive("heading", { level: 2 }), bullet: e.isActive("bulletList"), ordered: e.isActive("orderedList"), task: e.isActive("taskList"), quote: e.isActive("blockquote") } : null })
  const tool = (label: string, active: boolean | undefined, run: () => void, icon: React.ReactNode) => (
    <Button type="button" variant="ghost" size="icon" className={cn("size-7", active && "bg-accent text-accent-foreground")} aria-pressed={!!active} aria-label={label} title={label} onClick={() => { interacted.current = true; run() }} disabled={state.readOnly || raw}>{icon}</Button>
  )
  const name = address.split("/").pop()

  return (
    <div
      data-boring="markdown-editor"
      data-dirty={state.dirty ? "" : undefined}
      className={cn("flex h-full min-h-0 flex-col bg-background text-foreground", className)}
      onPointerDownCapture={() => { interacted.current = true }}
      onKeyDownCapture={e => { interacted.current = true; if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); void actions.save() } }}
    >
      <div className="flex items-center gap-1 border-b px-3 py-1.5">
        <span className="mr-2 truncate text-sm font-medium" title={address}>{name}</span>
        {state.readOnly && <Badge variant="secondary" className="gap-1"><Lock className="size-3" />read-only</Badge>}
        {!state.readOnly && (
          <>
            {tool("Bold", marks?.bold, () => editor?.chain().focus().toggleBold().run(), <Bold className="size-4" />)}
            {tool("Italic", marks?.italic, () => editor?.chain().focus().toggleItalic().run(), <Italic className="size-4" />)}
            {tool("Strikethrough", marks?.strike, () => editor?.chain().focus().toggleStrike().run(), <Strikethrough className="size-4" />)}
            {tool("Code", marks?.code, () => editor?.chain().focus().toggleCode().run(), <Code className="size-4" />)}
            <Separator orientation="vertical" className="mx-1 h-4" />
            {tool("Heading 1", marks?.h1, () => editor?.chain().focus().toggleHeading({ level: 1 }).run(), <Heading1 className="size-4" />)}
            {tool("Heading 2", marks?.h2, () => editor?.chain().focus().toggleHeading({ level: 2 }).run(), <Heading2 className="size-4" />)}
            {tool("Bullet list", marks?.bullet, () => editor?.chain().focus().toggleBulletList().run(), <List className="size-4" />)}
            {tool("Numbered list", marks?.ordered, () => editor?.chain().focus().toggleOrderedList().run(), <ListOrdered className="size-4" />)}
            {tool("Task list", marks?.task, () => editor?.chain().focus().toggleTaskList().run(), <ListChecks className="size-4" />)}
            {tool("Quote", marks?.quote, () => editor?.chain().focus().toggleBlockquote().run(), <Quote className="size-4" />)}
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span data-boring="save-state" className="text-xs text-muted-foreground">
            {state.status !== "ready" ? state.status : state.saving ? "saving…" : state.dirty ? "unsaved" : `saved · r${state.saved?.revision ?? "?"}`}
          </span>
          <Button type="button" variant={raw ? "secondary" : "ghost"} size="sm" className="h-7 font-mono text-xs" onClick={() => setRaw(r => !r)} aria-pressed={raw}>MD</Button>
          {!state.readOnly && <Button type="button" size="sm" className="h-7" onClick={() => void actions.save()} disabled={!state.dirty || state.saving}><Save className="size-3.5" />Save</Button>}
        </div>
      </div>
      {state.conflict && <ConflictBanner className="rounded-none border-x-0 border-t-0" current={state.conflict.current} onReload={actions.reload} onOverwrite={actions.overwrite} onDismiss={actions.dismissConflict} />}
      {state.proposals.map(p => (
        <ProposalDiff key={p.id} proposal={p} readOnly={state.readOnly} onAccept={() => actions.accept(p.id)} onReject={() => actions.reject(p.id)} />
      ))}
      {state.error && state.status !== "ready" && <p role="alert" className="px-4 py-3 text-sm text-destructive">{state.error}</p>}
      <div className="min-h-0 flex-1 overflow-auto">
        {raw ? (
          <textarea
            aria-label="Raw markdown"
            className="h-full min-h-[240px] w-full resize-none bg-background px-8 py-6 font-mono text-[13px] leading-6 outline-none"
            value={state.buffer}
            readOnly={state.readOnly}
            spellCheck={false}
            onChange={e => actions.edit(e.target.value)}
          />
        ) : (
          <EditorContent editor={editor} />
        )}
      </div>
    </div>
  )
}
