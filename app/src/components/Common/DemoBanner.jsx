import { useNavigate } from 'react-router-dom'

// Persistent bar shown while a visitor is exploring in guest demo mode. Reminds
// them nothing persists and offers a one-click path to a real account. Styled to
// Cinder's dark cosmic theme via the shared CSS variables.
export default function DemoBanner({ onSignUp }) {
  const navigate = useNavigate()

  const handleSignUp = () => {
    onSignUp?.()          // leave guest mode: restore real storage + network
    navigate('/register')
  }

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1300,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '14px',
        flexWrap: 'wrap',
        padding: '9px 18px',
        backgroundColor: 'var(--bg-elevated)',
        borderTop: '1px solid var(--border-strong)',
        boxShadow: '0 -6px 24px var(--shadow-color)',
        fontSize: '0.82rem',
        color: 'var(--text-secondary)',
      }}
    >
      <span
        aria-hidden
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: 'var(--accent-warning)',
          boxShadow: '0 0 8px var(--accent-warning)',
          flexShrink: 0,
        }}
      />
      <span>
        <strong style={{ color: 'var(--text-primary)' }}>Demo mode</strong>
        {' '}— nothing you do here is saved. Everything resets when you refresh.
      </span>
      <button
        type="button"
        onClick={handleSignUp}
        style={{
          appearance: 'none',
          border: '1px solid var(--accent-warning)',
          background: 'var(--accent-warning-alpha)',
          color: 'var(--accent-warning)',
          fontSize: '0.82rem',
          fontWeight: 600,
          padding: '5px 14px',
          borderRadius: '999px',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        Sign up to keep your work →
      </button>
    </div>
  )
}
