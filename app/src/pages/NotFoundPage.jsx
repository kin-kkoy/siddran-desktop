import { useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'

function NotFoundPage() {
    const navigate = useNavigate()

    return createPortal(
        <div style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'var(--bg-primary)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '16px',
        }}>
            <div style={{ fontSize: '2.2rem', color: 'var(--accent-warning)' }}>&#10022;</div>
            <h1 style={{
                fontFamily: 'var(--font-display)',
                fontSize: '72px',
                margin: 0,
                color: 'var(--text-muted)',
                lineHeight: 1,
            }}>404</h1>
            <p style={{
                fontSize: '0.7rem',
                color: 'var(--text-muted)',
                margin: 0,
                letterSpacing: '0.1em',
            }}>
                This page doesn't exist.
            </p>
            <button
                onClick={() => navigate('/notes')}
                style={{
                    marginTop: '12px',
                    padding: '0.5rem 1.2rem',
                    background: 'var(--accent-warning-alpha)',
                    color: 'var(--accent-warning)',
                    border: '1px solid rgba(240, 184, 64, 0.22)',
                    borderRadius: '4px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.75rem',
                    letterSpacing: '0.05em',
                    cursor: 'pointer',
                    transition: 'all 0.18s ease',
                }}
                onMouseEnter={e => {
                    e.target.style.background = 'rgba(240,184,64,0.14)'
                    e.target.style.borderColor = 'rgba(240,184,64,0.45)'
                }}
                onMouseLeave={e => {
                    e.target.style.background = 'var(--accent-warning-alpha)'
                    e.target.style.borderColor = 'rgba(240,184,64,0.22)'
                }}
            >
                &#10022; Back to Notes
            </button>
        </div>,
        document.body
    )
}

export default NotFoundPage
