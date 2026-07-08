import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from '../../utils/toast'
import styles from './Card.module.css'

function AddCardList({ addNote }) {
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
    <div onClick={handleClick} className={styles.addCardList}>
        <span className={styles.addCardListIcon}>+</span>
        <h4>Add Note</h4>
    </div>
  )
}

export default AddCardList
