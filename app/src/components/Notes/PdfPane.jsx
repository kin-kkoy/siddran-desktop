import { LuX } from 'react-icons/lu'
import { resolveImageUrl } from '../../utils/imageUpload'
import styles from './PdfPane.module.css'

// Right-column PDF viewer. The Bag-relative path is resolved to a webview asset
// URL (convertFileSrc) and shown in an <iframe> — WebKitGTK renders the PDF.
export default function PdfPane({ pdf, onClose }) {
  const src = pdf?.path ? resolveImageUrl(pdf.path) : ''
  return (
    <div className={styles.pane}>
      <div className={styles.header}>
        <span className={styles.name} title={pdf?.name}>{pdf?.name || 'PDF'}</span>
        <button className={styles.closeBtn} onClick={onClose} title="Close PDF" aria-label="Close PDF">
          <LuX size={16} />
        </button>
      </div>
      {src ? (
        <iframe className={styles.frame} src={src} title={pdf?.name || 'PDF'} />
      ) : (
        <div className={styles.empty}>Could not load PDF</div>
      )}
    </div>
  )
}
