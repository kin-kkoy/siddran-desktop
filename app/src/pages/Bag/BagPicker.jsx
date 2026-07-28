import styles from './BagPicker.module.css'

// The desktop entry screen. No login, no account — you open a "Bag" (a vault: a
// folder that holds your notes/tasks) and you're in. The backpack + zipper is the
// signature: a Bag is a thing you pack and carry through the void.
export default function BagPicker({ recentBags = [], onOpen, onCreate, onOpenRecent, onRemoveRecent, busy }) {
  return (
    <div className={styles.screen}>
      <div className={styles.stage}>

        {/* ── the pack (signature) ───────────────────────────────── */}
        <div className={styles.pack} aria-hidden="true">
          <Backpack />
        </div>

        <header className={styles.head}>
          <p className={styles.eyebrow}>SPACE DRIFTING · LOCAL BAG</p>
          <h1 className={styles.wordmark}>Siddran</h1>
          <p className={styles.tagline}>
            Open a Bag to begin. Your notes live in a folder you own — nothing leaves this machine.
          </p>
        </header>

        {/* ── primary actions ────────────────────────────────────── */}
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={onOpen} disabled={busy}>
            <ZipIcon /> Open a Bag
          </button>
          <button type="button" className={styles.ghost} onClick={onCreate} disabled={busy}>
            <PlusIcon /> Create a Bag
          </button>
        </div>

        {/* ── your bags ──────────────────────────────────────────── */}
        <section className={styles.recent}>
          <p className={styles.recentHead}>
            Your Bags{recentBags.length > 0 ? ` · ${recentBags.length}` : ''}
          </p>
          {recentBags.length === 0 ? (
            <p className={styles.empty}>No Bags yet — create your first to start packing.</p>
          ) : (
            <ul className={styles.list}>
              {recentBags.map((bag) => (
                <li key={bag.path} className={styles.bagItem}>
                  <button type="button" className={styles.bagRow} onClick={() => onOpenRecent(bag)} disabled={busy}>
                    <span className={styles.bagIcon} aria-hidden="true"><BagGlyph /></span>
                    <span className={styles.bagName}>{bag.name}</span>
                    <span className={styles.bagPath}>{bag.path}</span>
                    <span className={styles.bagGo} aria-hidden="true">→</span>
                  </button>
                  {onRemoveRecent && (
                    <button
                      type="button"
                      className={styles.bagRemove}
                      onClick={() => onRemoveRecent(bag)}
                      disabled={busy}
                      title="Remove from list (does not delete the folder)"
                      aria-label={`Remove ${bag.name} from the list`}
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className={styles.footer}>Siddran Desktop · v0.1.0</footer>
      </div>
    </div>
  )
}

// ── Inline SVG: a space backpack with an amber zipper ──────────────────
function Backpack() {
  return (
    <svg viewBox="0 0 300 340" className={styles.svg} role="img">
      <defs>
        <linearGradient id="fabric" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#26263e" />
          <stop offset="1" stopColor="#14142200" />
          <stop offset="1" stopColor="#141422" />
        </linearGradient>
        <linearGradient id="fabricFlap" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2e2e4a" />
          <stop offset="1" stopColor="#1c1c30" />
        </linearGradient>
        <linearGradient id="amber" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffd67a" />
          <stop offset="1" stopColor="#f0b840" />
        </linearGradient>
        <radialGradient id="patch" cx="0.5" cy="0.4" r="0.7">
          <stop offset="0" stopColor="#1c1c30" />
          <stop offset="1" stopColor="#0e0e1a" />
        </radialGradient>
        <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>

      {/* ground shadow */}
      <ellipse cx="150" cy="320" rx="88" ry="12" fill="#000" opacity="0.42" filter="url(#soft)" />

      {/* Carry handle. Both feet land ON the body's top edge, so it reads as an
          attached grab handle instead of a floating arc. */}
      <path className={styles.handle} d="M118 132 C118 86 182 86 182 132" />

      {/* Body — one closed silhouette, gently flared toward the base. */}
      <path className={styles.body}
        d="M78 152 Q78 126 106 126 H194 Q222 126 222 152 L230 278 Q232 310 198 310 H102 Q68 310 70 278 Z" />

      {/* Lid seam + zipper. The pull rests at the LEFT end and travels the full seam
          on hover. It rides the curve via CSS offset-path (see the module CSS) rather
          than a straight translate, which is what used to make it leave its own line. */}
      <path className={styles.zipTrack} d="M80 158 Q150 186 220 158" />
      <path className={styles.zipTeeth} d="M80 158 Q150 186 220 158" />
      <g className={styles.pull}>
        <circle r="6.5" fill="none" stroke="url(#amber)" strokeWidth="3" />
        <rect x="-3" y="7" width="6" height="15" rx="3" fill="url(#amber)" />
      </g>

      {/* Front pocket, inset from the body edges so the outline stays readable. */}
      <path className={styles.pocket}
        d="M106 232 H194 Q208 232 208 246 V276 Q208 292 192 292 H108 Q92 292 92 276 V246 Q92 232 106 232 Z" />
      <rect className={styles.clasp} x="140" y="224" width="20" height="13" rx="4" />
      {/* star badge, centred on the pocket */}
      <path className={styles.star}
        d="M150 249 L153.2 257.6 L162.4 258 L155.1 263.7 L157.6 272.5 L150 267.4
           L142.4 272.5 L144.9 263.7 L137.6 258 L146.8 257.6 Z" />
    </svg>
  )
}

// A compact bag chip for each Recent row — echoes the big pack's amber zipper.
function BagGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="bagchip" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffd67a" />
          <stop offset="1" stopColor="#f0b840" />
        </linearGradient>
      </defs>
      {/* handle */}
      <path d="M8 8.5 C8 4.8 16 4.8 16 8.5" fill="none" stroke="#f0b840" strokeWidth="1.4" strokeLinecap="round" opacity="0.8" />
      {/* body */}
      <rect x="3.5" y="8" width="17" height="12.5" rx="4" fill="#141422" stroke="#3a3a5c" strokeWidth="1.2" />
      {/* zipper + amber pull */}
      <path d="M5 11.6 Q12 9.9 19 11.6" fill="none" stroke="url(#bagchip)" strokeWidth="1.3" strokeLinecap="round" strokeDasharray="0.5 2.4" />
      <circle cx="12" cy="10.9" r="1.7" fill="url(#bagchip)" />
    </svg>
  )
}

const ZipIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 1v14" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2 2" />
    <rect x="5.5" y="7" width="5" height="6" rx="2" fill="currentColor" />
  </svg>
)
const PlusIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
)
