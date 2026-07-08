import styles from './Skeleton.module.css'

function Skeleton({ width, height, radius = 6, className, style }) {
    return (
        <div
            className={`${styles.skeleton} ${className || ''}`}
            style={{ width, height, borderRadius: radius, ...style }}
        />
    )
}

export default Skeleton
