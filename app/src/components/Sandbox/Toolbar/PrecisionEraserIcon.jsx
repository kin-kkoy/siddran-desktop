// The regular eraser, smaller, with its tip resting in a gap it has cut in a
// line beneath it — "erase just this bit". It shares the eraser's outline so
// the two read as a family. (Earlier tries — an eraser with a target, then a
// dashed ring on a squiggle — read as a highlighter and as a "black hole".)
function PrecisionEraserIcon({ size = 20 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {/* eraser body: the lucide eraser outline at 72%, its tip in the gap */}
            <g transform="translate(4.2 3.6) scale(0.72)" strokeWidth="2.6">
                <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
                <path d="m5 11 9 9" />
            </g>
            {/* the line it is erasing, with the erased gap under the tip */}
            <path d="M2 21h6" />
            <path d="M15 21h7" />
        </svg>
    )
}

export default PrecisionEraserIcon
