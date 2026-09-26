// Consistent stroke-based icon set for the toolbar (all inherit currentColor)

const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }

function Svg({ size = 16, children, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} {...rest}>
      {children}
    </svg>
  )
}

export function SearchIcon(props) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.8-3.8" />
    </Svg>
  )
}

export function ZoomOutIcon(props) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.8-3.8" />
      <path d="M8.5 11h5" />
    </Svg>
  )
}

export function ZoomInIcon(props) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.8-3.8" />
      <path d="M8.5 11h5M11 8.5v5" />
    </Svg>
  )
}

export function FitIcon(props) {
  return (
    <Svg {...props}>
      <path d="M4 9V4h5" />
      <path d="M9 20H4v-5" />
      <path d="M20 9V4h-5" />
      <path d="M15 20h5v-5" />
    </Svg>
  )
}

export function UndoIcon(props) {
  return (
    <Svg {...props}>
      <path d="M9 7 4 12l5 5" />
      <path d="M4 12h11a5 5 0 0 1 5 5v1" />
    </Svg>
  )
}

export function RedoIcon(props) {
  return (
    <Svg {...props}>
      <path d="M15 7l5 5-5 5" />
      <path d="M20 12H9a5 5 0 0 0-5 5v1" />
    </Svg>
  )
}

export function CopyIcon(props) {
  return (
    <Svg {...props}>
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M4 16V5a2 2 0 0 1 2-2h9" />
    </Svg>
  )
}

export function HelpIcon(props) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.4 9a2.7 2.7 0 0 1 5.2 1c0 1.7-2.6 2.3-2.6 3.6" />
      <circle cx="12" cy="17.6" r="0.4" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function DownloadIcon(props) {
  return (
    <Svg {...props}>
      <path d="M12 4v10" />
      <path d="m7 10 5 5 5-5" />
      <path d="M4 20h16" />
    </Svg>
  )
}

export function UploadIcon(props) {
  return (
    <Svg {...props}>
      <path d="M12 15V5" />
      <path d="m7 9 5-5 5 5" />
      <path d="M4 20h16" />
    </Svg>
  )
}

export function MoveIcon(props) {
  return (
    <Svg {...props}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
      <path d="m12 3 2 2.2h-4L12 3ZM12 21l2-2.2h-4l2 2.2ZM3 12l2.2-2v4L3 12ZM21 12l-2.2-2v4l2.2-2Z" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function NoteIcon(props) {
  return (
    <Svg {...props}>
      <path d="M5 4h10l4 4v12H5z" />
      <path d="M15 4v4h4" />
      <path d="M8 13h8M8 16.5h5" />
    </Svg>
  )
}

export function PinIcon(props) {
  return (
    <Svg {...props}>
      <path d="M12 3c0 0 5 3.6 5 8 0 1.3-.6 2.2-.6 2.2H7.6S7 12.3 7 11c0-4.4 5-8 5-8Z" />
      <path d="M10 13.2h4l-.8 7h-2.4Z" />
      <path d="M12 20.2V23" />
    </Svg>
  )
}

export function EnvelopeIcon(props) {
  return (
    <Svg {...props}>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="m3 7.5 9 6.5 9-6.5" />
    </Svg>
  )
}

export function FileIcon(props) {
  return (
    <Svg {...props}>
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v4h4" />
      <path d="M9.5 12h5M9.5 15.5h5" />
    </Svg>
  )
}

export function LinkIcon(props) {
  return (
    <Svg {...props}>
      <path d="M9.4 14.6 14.6 9.4" />
      <path d="M7.6 11.8 5.4 14a3.2 3.2 0 0 0 4.5 4.5l2.3-2.2" />
      <path d="M16.4 12.2 18.6 10a3.2 3.2 0 0 0-4.5-4.5l-2.3 2.2" />
    </Svg>
  )
}

export function NewspaperIcon(props) {
  return (
    <Svg {...props}>
      <path d="M4 5h13v13a1 1 0 0 0 1 1H6a2 2 0 0 1-2-2z" />
      <path d="M17 8h2a1 1 0 0 1 1 1v8a2 2 0 0 1-2 2" />
      <path d="M7 8.5h7M7 11.5h7M7 14.5h4" />
    </Svg>
  )
}

export function SignOutIcon(props) {
  return (
    <Svg {...props}>
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <path d="M10 16l4-4-4-4" />
      <path d="M14 12H4" />
    </Svg>
  )
}

export function GoogleIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 34.9 26.7 36 24 36c-5.2 0-9.6-3.1-11.3-7.6l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.1 5.5l6.3 5.3C37.2 39.2 44 34 44 24c0-1.3-.1-2.3-.4-3.5z" />
    </svg>
  )
}
export function ChartIcon(props) {
  return (
    <Svg {...props}>
      <path d="M4 20V11" />
      <path d="M10 20V4" />
      <path d="M16 20v-6" />
      <path d="M3 20h18" />
    </Svg>
  )
}
