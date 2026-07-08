import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from '../../utils/toast'
import styles from './Card.module.css'

function AddCard({ addNote }) {
  const navigate = useNavigate()
  const inFlightRef = useRef(false)

  const handleClick = async () => {
    if (inFlightRef.current) return
    inFlightRef.current = true

    const toastId = toast.loading('Creating note…')

    try {
      const result = await addNote(
        "Untitled",
        (optimistic) => {
          if (optimistic?.id) navigate(`/notes/${optimistic.id}`)
        },
        (real) => {
          // Swap URL to the real id without adding a history entry
          if (real?.id) navigate(`/notes/${real.id}`, { replace: true })
        }
      )

      if (result) {
        toast.update(toastId, 'Note created', 'success')
      } else {
        toast.dismiss(toastId)
      }
    } finally {
      inFlightRef.current = false
    }
  }

  return (
    <div onClick={handleClick} className={styles.addCard}>
        <span className={styles.addCardIcon}>+</span>
        <h2>Add Note</h2>
    </div>
  )
}

export default AddCard
