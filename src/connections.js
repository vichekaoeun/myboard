// Connection types for red-string links: each controls the string's colour,
// line style, and whether it's directional (drawn with an arrowhead).

export const CONNECTION_TYPES = {
  related:   { id: 'related',   label: 'Related',    color: '#b0252b', dashed: false, directed: false },
  leads:     { id: 'leads',     label: 'Leads to',   color: '#c98a1e', dashed: false, directed: true },
  blocks:    { id: 'blocks',    label: 'Blocks',     color: '#3b3b3b', dashed: true,  directed: true },
  supports:  { id: 'supports',  label: 'Supports',   color: '#5b8c3e', dashed: false, directed: false },
  reference: { id: 'reference', label: 'Reference',  color: '#2f6fb0', dashed: false, directed: false },
}

export const CONNECTION_ORDER = ['related', 'leads', 'blocks', 'supports', 'reference']

export function connType(id) {
  return CONNECTION_TYPES[id] || CONNECTION_TYPES.related
}

export function connText(link) {
  const t = connType(link && link.type)
  return link && link.label ? `${t.label} · ${link.label}` : t.label
}
