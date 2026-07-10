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

      {/* drop shadow */}
      <ellipse cx="150" cy="322" rx="96" ry="14" fill="#000" opacity="0.45" filter="url(#soft)" />

      {/* shoulder straps (behind the body) */}
      <path className={styles.strap} d="M108 78 C 78 60 70 120 84 190" />
      <path className={styles.strap} d="M192 78 C 222 60 230 120 216 190" />
      {/* buckles */}
      <rect className={styles.buckle} x="78" y="150" width="16" height="11" rx="3" />
      <rect className={styles.buckle} x="206" y="150" width="16" height="11" rx="3" />

      {/* top haul loop — base tucks behind the flap (drawn later) so it reads as
          an attached grab handle rather than a floating arc */}
      <path className={styles.loop} d="M136 90 q14 -24 28 0" />

      {/* main body */}
      <rect x="54" y="86" width="192" height="228" rx="46" fill="url(#fabric)" stroke="#3a3a5c" strokeWidth="2" />
      {/* stitch line */}
      <rect className={styles.stitch} x="64" y="96" width="172" height="208" rx="38" />

      {/* front pocket */}
      <path fill="#1a1a2c" stroke="#3a3a5c" strokeWidth="2"
        d="M92 214 h116 a14 14 0 0 1 14 14 v58 a20 20 0 0 1 -20 20 h-104 a20 20 0 0 1 -20 -20 v-58 a14 14 0 0 1 14 -14 z" />
      {/* pocket zipper (small) */}
      <g className={styles.zipSmall}>
        <line x1="98" y1="230" x2="202" y2="230" />
        <line className={styles.teeth} x1="98" y1="230" x2="202" y2="230" />
        <circle cx="150" cy="230" r="4.5" fill="url(#amber)" />
      </g>

      {/* star patch badge */}
      <circle cx="150" cy="176" r="30" fill="url(#patch)" stroke="#f0b840" strokeWidth="2" opacity="0.95" />
      <path className={styles.star} d="M150 158 l6 12 13 2 -9.5 9 2.5 13 -12 -6.5 -12 6.5 2.5 -13 -9.5 -9 13 -2 z" />

      {/* top flap */}
      <path fill="url(#fabricFlap)" stroke="#3a3a5c" strokeWidth="2"
        d="M54 132 v-2 a46 46 0 0 1 46 -44 h100 a46 46 0 0 1 46 44 v2 a10 10 0 0 1 -6 9 q-90 34 -180 0 a10 10 0 0 1 -6 -9 z" />

      {/* THE zipper (signature) — track, interlocking teeth, amber pull */}
      <g className={styles.zip}>
        <path className={styles.zipTrack} d="M70 138 q80 26 160 0" />
        <path className={styles.zipTeeth} d="M70 138 q80 26 160 0" />
        <g className={styles.pull}>
          <rect x="144" y="150" width="12" height="20" rx="4" fill="url(#amber)" />
          <circle cx="150" cy="150" r="5.5" fill="none" stroke="url(#amber)" strokeWidth="3" />
          <rect x="147" y="168" width="6" height="10" rx="3" fill="#f0b840" />
        </g>
      </g>
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
