import { useNavigate } from 'react-router-dom'
import { LuArrowLeft, LuArrowRight } from 'react-icons/lu'
import styles from './NavArrows.module.css'

// Browser-style back/forward arrows. Shown only on pages that opt in (NotePage,
// SandBoxPage); mouse buttons 4/5 cover history navigation everywhere else.
export default function NavArrows({ className = '' }) {
  const navigate = useNavigate()
  return (
    <div className={`${styles.wrap} ${className}`}>
      <button className={styles.btn} onClick={() => navigate(-1)} title="Back" aria-label="Back">
        <LuArrowLeft size={16} />
      </button>
      <button className={styles.btn} onClick={() => navigate(1)} title="Forward" aria-label="Forward">
        <LuArrowRight size={16} />
      </button>
    </div>
  )
}
