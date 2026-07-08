
function ModsHub() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '65vh',
      flexDirection: 'column',
      gap: '1rem',
      opacity: 0.3,
    }}>
      <div style={{ fontSize: '2.2rem', color: 'var(--accent-warning)' }}>&#10022;</div>
      <div style={{
        fontFamily: 'var(--font-display)',
        fontSize: '1rem',
        fontWeight: 700,
        letterSpacing: '0.12em',
      }}>COMING SOON</div>
      <div style={{
        fontSize: '0.7rem',
        color: 'var(--text-muted)',
        letterSpacing: '0.1em',
      }}>This module is in the works</div>
    </div>
  )
}

export default ModsHub
