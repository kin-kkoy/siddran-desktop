// Builds a rendered <table> DOM node from GFM table markdown, for the live-preview
// table widget. Cells are set via textContent (never innerHTML) so note content
// can't inject markup — XSS-safe by construction.
//
// Cells render inline markdown (bold/italic/code/strike/highlight/underline/links)
// via renderInlineInto — DOM-built, never innerHTML, so it stays XSS-safe.

import { parseTable } from './tableModel'
import { renderInlineInto } from './inlineRender'

export function renderTableDOM(md) {
  const wrap = document.createElement('div')
  wrap.className = 'cm-live-table'
  wrap.setAttribute('contenteditable', 'false') // the widget is display-only; edit via source

  const model = parseTable(md)
  if (!model) {
    // Only called on parsed Table nodes, so this is a safety net — show the raw text
    // rather than an empty box if a malformed table slips through.
    wrap.textContent = md
    return wrap
  }

  const table = document.createElement('table')

  const thead = document.createElement('thead')
  const htr = document.createElement('tr')
  model.headers.forEach((h, i) => {
    const th = document.createElement('th')
    renderInlineInto(th, h)
    if (model.aligns[i]) th.style.textAlign = model.aligns[i]
    htr.appendChild(th)
  })
  thead.appendChild(htr)
  table.appendChild(thead)

  if (model.rows.length) {
    const tbody = document.createElement('tbody')
    model.rows.forEach((row) => {
      const tr = document.createElement('tr')
      row.forEach((cell, i) => {
        const td = document.createElement('td')
        renderInlineInto(td, cell)
        if (model.aligns[i]) td.style.textAlign = model.aligns[i]
        tr.appendChild(td)
      })
      tbody.appendChild(tr)
    })
    table.appendChild(tbody)
  }

  wrap.appendChild(table)
  return wrap
}
