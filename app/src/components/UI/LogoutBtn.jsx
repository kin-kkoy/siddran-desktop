
function LogoutBtn({ handleLogout, isCollapsed }) {
    const btnStyle = {
        backgroundColor: '#dc3545',
        border: 'none',
        color: '#fff',
        padding: '12px 16px',
        cursor: 'pointer',
        borderRadius: '6px',
        fontSize: '14px',
        transition: 'background-color 0.2s',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: isCollapsed ? 'center' : 'flex-start',
        gap: '10px'
    }
  
    return (
        <button style={btnStyle} 
        onClick={handleLogout}
        onMouseEnter={(e) => e.target.style.backgroundColor = '#c82333'}
        onMouseLeave={(e) => e.target.style.backgroundColor = '#dc3545'}
        title="Logout"  // Tooltip for collapsed state
        >
            <span>🚪</span>
            {!isCollapsed && <span>Logout</span>}
        </button>
    )
}

export default LogoutBtn