import { useState } from 'react'
import { LuChevronDown, LuChevronRight } from 'react-icons/lu'
import styles from './TrustPromptModal.module.css'

// Asked when a page wants to save state and hasn't been answered for yet.
// Deliberately short at rest: the decision is "does this page get to remember
// things", and the reasoning is one click away for whoever needs it — including
// future-you, months from now, with no memory of how any of this works.
export default function TrustPromptModal({ name, onTrust, onBlock }) {
  const [why, setWhy] = useState(false)
  const [dontAsk, setDontAsk] = useState(false)

  return (
    <div className={styles.backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget) onBlock(dontAsk) }}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Trust this page?">
        <h3 className={styles.title}>This page wants to read its own data files</h3>
        <p className={styles.lead}>
          It&rsquo;s blocked from reading anything unless you trust it, so parts of it may stay empty.
        </p>
        {name && <p className={styles.file} title={name}>{name}</p>}

        <button type="button" className={styles.whyBtn} onClick={() => setWhy((v) => !v)} aria-expanded={why}>
          {why ? <LuChevronDown size={13} /> : <LuChevronRight size={13} />} Why am I seeing this?
        </button>

        {why && (
          <div className={styles.why}>
            <p>
              HTML files can run code, so Siddran walls them off from your vault by
              default. Saving their own state still works — Siddran keeps that for them.
              Reading files does not.
            </p>
            <p>
              A trusted page can read any file in your Bag — every note, not just this one.
              It can&rsquo;t delete or change them.
            </p>
            <p>
              If web fonts are turned on in Settings, a trusted page can also reach the
              internet, and could send what it read there. With that off, it stays offline.
            </p>
            <p>
              Trust a page only if you know where it came from. Pages you wrote yourself are fine.
            </p>
          </div>
        )}

        <label className={styles.check}>
          <input type="checkbox" checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} />
          <span>Don&rsquo;t ask again for this page</span>
        </label>

        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={() => onBlock(dontAsk)}>
            Keep it blocked
          </button>
          <button type="button" className={styles.primary} onClick={() => onTrust(dontAsk)}>
            Trust this page
          </button>
        </div>
        <p className={styles.note}>The page will reload.</p>
      </div>
    </div>
  )
}
