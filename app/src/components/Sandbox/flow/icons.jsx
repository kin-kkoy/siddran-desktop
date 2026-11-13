// Icons drawn for the diagram tools, in lucide's style (24 grid, 2px round
// strokes) so they sit with the rest of the dock.

/** A tiny flowchart: a step, down to a decision, across to an end. */
export function DiagramIcon({ size = 21 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="1.5" width="10" height="5.5" rx="1.2" />
      <path d="M7 7v2.5" />
      <path d="M7 9.5l5.5 5.5L7 20.5 1.5 15z" />
      <path d="M12.5 15h2.5" />
      <rect x="15" y="12" width="7.5" height="6" rx="3" />
    </svg>
  )
}

/** A step, a link down, and a ⊕: "add the next step". */
export function NextStepIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="2" width="16" height="7" rx="1.5" />
      <path d="M12 9v4" />
      <circle cx="12" cy="17.5" r="4.5" />
      <path d="M12 15.5v4M10 17.5h4" />
    </svg>
  )
}
