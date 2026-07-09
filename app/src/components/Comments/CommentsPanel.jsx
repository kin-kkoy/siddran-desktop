import { useEffect, useRef, useState } from 'react'
import { LuX, LuCheck, LuTrash2, LuRotateCcw, LuUnlink } from 'react-icons/lu'
import styles from './CommentsPanel.module.css'

// Short timestamp: "10:02" today, "Jul 9" earlier, "Jul 9 '25" other years.
function fmtTime(iso) {
  const d = new Date(iso)
  if (isNaN(d)) return ''
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const opts = { month: 'short', day: 'numeric' }
  if (d.getFullYear() !== now.getFullYear()) return d.toLocaleDateString([], { ...opts, year: '2-digit' })
  return d.toLocaleDateString([], opts)
}

// Small growing textarea used by the draft + reply composers.
function Composer({ value, onChange, onSubmit, onCancel, placeholder, submitLabel, autoFocus }) {
  const ref = useRef(null)
  useEffect(() => { if (autoFocus && ref.current) ref.current.focus() }, [autoFocus])
  const submit = () => { if (value.trim()) onSubmit() }
  return (
    <div className={styles.composer}>
      <textarea
        ref={ref}
        className={styles.textarea}
        value={value}
        placeholder={placeholder}
        rows={2}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit() }
          if (e.key === 'Escape' && onCancel) { e.preventDefault(); onCancel() }
        }}
      />
      <div className={styles.composerActions}>
        {onCancel && <button className={styles.btnGhost} onClick={onCancel}>Cancel</button>}
        <button className={styles.btnPrimary} onClick={submit} disabled={!value.trim()}>{submitLabel}</button>
      </div>
    </div>
  )
}

function ThreadCard({ thread, active, onSelect, onReply, onResolve, onDelete, onDeleteComment }) {
  const [reply, setReply] = useState('')
  const [replying, setReplying] = useState(false)
  const [initial, ...replies] = thread.comments

  const sendReply = () => { onReply(thread.id, reply); setReply(''); setReplying(false) }

  return (
    <div
      className={`${styles.card} ${active ? styles.cardActive : ''} ${thread.resolved ? styles.cardResolved : ''}`}
      onClick={() => onSelect(thread.id)}
    >
      <div className={styles.quote}>
        {thread.orphaned && <LuUnlink size={11} className={styles.orphanIcon} title="The commented text was deleted" />}
        <span className={styles.quoteText}>{thread.quote || '(no text)'}</span>
      </div>

      {initial && (
        <div className={styles.comment}>
          <div className={styles.commentBody}>{initial.text}</div>
          <div className={styles.commentMeta}>
            <span>{fmtTime(initial.createdAt)}</span>
            <button
              className={styles.metaBtn}
              title="Delete comment"
              onClick={(e) => { e.stopPropagation(); onDeleteComment(thread.id, initial.id) }}
            >
              <LuTrash2 size={12} />
            </button>
          </div>
        </div>
      )}

      {replies.map((c) => (
        <div key={c.id} className={`${styles.comment} ${styles.reply}`}>
          <div className={styles.commentBody}>{c.text}</div>
          <div className={styles.commentMeta}>
            <span>{fmtTime(c.createdAt)}</span>
            <button
              className={styles.metaBtn}
              title="Delete reply"
              onClick={(e) => { e.stopPropagation(); onDeleteComment(thread.id, c.id) }}
            >
              <LuTrash2 size={12} />
            </button>
          </div>
        </div>
      ))}

      {replying ? (
        <div onClick={(e) => e.stopPropagation()}>
          <Composer
            value={reply}
            onChange={setReply}
            onSubmit={sendReply}
            onCancel={() => { setReply(''); setReplying(false) }}
            placeholder="Continue the thread…"
            submitLabel="Add"
            autoFocus
          />
        </div>
      ) : (
        <div className={styles.cardActions} onClick={(e) => e.stopPropagation()}>
          <button className={styles.actionBtn} onClick={() => setReplying(true)}>Continue thread</button>
          <button
            className={styles.actionBtn}
            onClick={() => onResolve(thread.id, !thread.resolved)}
            title={thread.resolved ? 'Reopen' : 'Resolve'}
          >
            {thread.resolved ? <><LuRotateCcw size={12} /> Reopen</> : <><LuCheck size={12} /> Resolve</>}
          </button>
          <button className={`${styles.actionBtn} ${styles.danger}`} onClick={() => onDelete(thread.id)} title="Delete thread">
            <LuTrash2 size={12} />
          </button>
        </div>
      )}
    </div>
  )
}

export default function CommentsPanel({
  threads = [], draft, activeId,
  onSubmitDraft, onCancelDraft,
  onSelectThread, onReply, onResolve, onDelete, onDeleteComment, onClose,
}) {
  const [draftText, setDraftText] = useState('')
  const [showResolved, setShowResolved] = useState(false)
  useEffect(() => { setDraftText('') }, [draft?.id])

  const resolvedCount = threads.filter((t) => t.resolved).length
  const visible = threads
    .filter((t) => showResolved || !t.resolved)
    .sort((a, b) => (a.from ?? 0) - (b.from ?? 0) || (a.createdAt < b.createdAt ? -1 : 1))

  return (
    <aside className={styles.panel} aria-label="Comments">
      <div className={styles.head}>
        <span className={styles.title}>Comments</span>
        <button className={styles.closeBtn} onClick={onClose} title="Close comments" aria-label="Close comments">
          <LuX size={14} />
        </button>
      </div>

      {draft && (
        <div className={`${styles.card} ${styles.cardActive}`}>
          <div className={styles.quote}>
            <span className={styles.quoteText}>{draft.quote || '(no text)'}</span>
          </div>
          <Composer
            value={draftText}
            onChange={setDraftText}
            onSubmit={() => onSubmitDraft(draftText)}
            onCancel={onCancelDraft}
            placeholder="Add a comment…"
            submitLabel="Comment"
            autoFocus
          />
        </div>
      )}

      {visible.length === 0 && !draft ? (
        <div className={styles.empty}>
          Select text in the note, then click the comment button to start a thread.
        </div>
      ) : (
        visible.map((t) => (
          <ThreadCard
            key={t.id}
            thread={t}
            active={t.id === activeId}
            onSelect={onSelectThread}
            onReply={onReply}
            onResolve={onResolve}
            onDelete={onDelete}
            onDeleteComment={onDeleteComment}
          />
        ))
      )}

      {resolvedCount > 0 && (
        <button className={styles.showResolved} onClick={() => setShowResolved((v) => !v)}>
          {showResolved ? 'Hide' : 'Show'} resolved ({resolvedCount})
        </button>
      )}
    </aside>
  )
}
