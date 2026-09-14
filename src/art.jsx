// Hand-crafted realistic visuals: cork, wood grain, paper, push pins, envelopes.

export function corkTexture() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
      <filter id="cork">
        <feTurbulence type="fractalNoise" baseFrequency="0.06 0.09" numOctaves="4" seed="7" result="n" />
        <feColorMatrix in="n" type="saturate" values="0" result="g" />
        <feComponentTransfer in="g" result="d">
          <feFuncA type="discrete" tableValues="0 0 0.06 0.05 0.02 0 0.08" />
        </feComponentTransfer>
        <feComposite operator="over" in2="SourceGraphic" />
      </filter>
      <rect width="200" height="200" fill="#a9743f" filter="url(#cork)" opacity="0.5" />
    </svg>
  )
}

export function paperNoise() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="120" height="120">
      <filter id="pn">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="12" />
        <feColorMatrix type="saturate" values="0" />
        <feComponentTransfer>
          <feFuncA type="linear" slope="0.05" intercept="0" />
        </feComponentTransfer>
      </filter>
      <rect width="120" height="120" filter="url(#pn)" />
    </svg>
  )
}

export function paperCoarse() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="160" height="160">
      <filter id="pc">
        <feTurbulence type="fractalNoise" baseFrequency="0.18" numOctaves="3" seed="3" />
        <feColorMatrix type="saturate" values="0" />
        <feComponentTransfer>
          <feFuncA type="linear" slope="0.05" intercept="0" />
        </feComponentTransfer>
      </filter>
      <rect width="160" height="160" filter="url(#pc)" />
    </svg>
  )
}

const PIN_METAL = [
  ['#d8dde4', '#9aa3ae', '#50555c'],
  ['#e7b02e', '#b07f14', '#6e4f0c'],
  ['#e95d5d', '#ae2f37', '#6f1519'],
  ['#5d9be0', '#2f6db8', '#163f72'],
  ['#58c077', '#2c9150', '#135b31'],
  ['#9b7fd6', '#6d52ae', '#3d2c6b'],
]

export function pinGroups() {
  return PIN_METAL.map((c, i) => ({ id: i, color: c[0], dark: c[1], deep: c[2] }))
}

export function PushPin({ color, size = 34 }) {
  const base = PIN_METAL.find((c) => c[0] === color) || PIN_METAL[0]
  const [light, mid, dark] = base
  return (
    <svg width={size} height={size * 1.9} viewBox="0 0 44 84" className="pushpin">
      <defs>
        <radialGradient id={`pph-${light.slice(1)}`} cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="28%" stopColor={light} />
          <stop offset="75%" stopColor={mid} />
          <stop offset="100%" stopColor={dark} />
        </radialGradient>
        <linearGradient id={`ppm-${light.slice(1)}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#e8eef4" />
          <stop offset="50%" stopColor="#b7c0c9" />
          <stop offset="100%" stopColor="#79828c" />
        </linearGradient>
      </defs>
      <ellipse cx="22" cy="62" rx="11" ry="3.6" fill="rgba(20,12,4,0.28)" />
      <path
        d="M22 10 C 22 10, 8.5 25, 7 30 C 5.4 35.2, 12 45, 12 52 L 12 56 A 10 6 0 0 0 22 56 A 10 6 0 0 0 32 56 L 32 52 C 32 45, 38.6 35.2, 37 30 C 35.5 25, 22 10, 22 10 Z"
        fill={`url(#ppm-${light.slice(1)})`}
      />
      <circle cx="22" cy="19" r="13" fill={`url(#pph-${light.slice(1)})`} />
      <circle cx="17" cy="14.5" r="3.4" fill="rgba(255,255,255,0.75)" />
      <ellipse cx="26" cy="25" rx="2.2" ry="1.4" fill="rgba(255,255,255,0.35)" />
      <path d="M16 20 q 6 -4 12 0" stroke="rgba(255,255,255,0.4)" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  )
}

// A note laid flat with its own pin, seen from above (used inside envelopes fan)
export function EnvelopeFlapOpen() {
  return (
    <svg viewBox="0 0 300 210" width="100%" height="100%" preserveAspectRatio="none">
      <defs>
        <linearGradient id="envBase" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e8dcc0" />
          <stop offset="100%" stopColor="#cfbe97" />
        </linearGradient>
        <linearGradient id="envFlap" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f0e6ce" />
          <stop offset="100%" stopColor="#d9c9a6" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="292" height="202" rx="6" fill="rgba(0,0,0,0.18)" />
      <rect x="2" y="2" width="292" height="202" rx="6" fill="url(#envBase)" stroke="#b7a276" strokeWidth="1.5" />
      <path d="M6 4 L150 110 L294 4 Z" fill="url(#envFlap)" stroke="#a58f66" strokeWidth="1" />
      <path d="M6 6 L150 112 L294 6" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.4" />
      <path d="M6 200 L150 110 Z M294 200 L150 110 Z" fill="#c3ad7f" opacity="0.55" />
      <path d="M6 202 L150 110 L294 202" fill="none" stroke="#9a8459" strokeWidth="1.4" />
      <circle cx="150" cy="112" r="11" fill="#a13d3d" stroke="#7c2c2c" strokeWidth="1.2" />
      <circle cx="150" cy="112" r="11" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
      <circle cx="147" cy="109" r="3" fill="rgba(255,255,255,0.5)" />
      <rect x="250" y="8" width="30" height="36" rx="2" fill="#f3e8cf" stroke="#b3a177" strokeWidth="1.2" />
      <path d="M252 12 h 26 M252 17 h 26 M252 22 h 26" stroke="#b3a177" strokeWidth="1" />
      <text x="30" y="70" fontFamily="EB Garamond, serif" fontSize="12" fill="#6b5a38" opacity="0.8">To:</text>
      <path d="M28 76 h 64 M28 88 h 84 M28 100 h 60" stroke="#8d7b52" strokeWidth="1.6" opacity="0.7" strokeLinecap="round" />
    </svg>
  )
}

export function EnvelopeClosed() {
  return (
    <svg viewBox="0 0 300 210" width="100%" height="100%" preserveAspectRatio="none">
      <defs>
        <linearGradient id="envB2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e8dcc0" />
          <stop offset="100%" stopColor="#cfbe97" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="292" height="202" rx="6" fill="rgba(0,0,0,0.18)" />
      <rect x="2" y="2" width="292" height="202" rx="6" fill="url(#envB2)" stroke="#b7a276" strokeWidth="1.5" />
      <path d="M6 6 L150 112 L294 6 L294 204 L6 204 Z" fill="#c9b489" opacity="0.55" />
      <path d="M6 202 L150 94 L294 202" fill="none" stroke="#9a8459" strokeWidth="1.4" />
      <path d="M6 8 L150 114 L294 8" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.4" />
      <path d="M10 6 Q150 130 290 6 Z" fill="rgba(255,250,238,0.55)" />
      <rect x="252" y="8" width="30" height="36" rx="2" fill="#f3e8cf" stroke="#b3a177" strokeWidth="1.2" />
      <path d="M254 12 h 26 M254 17 h 26 M254 22 h 26" stroke="#b3a177" strokeWidth="1" />
      <path d="M28 78 h 64 M28 90 h 84 M28 102 h 60 M132 78 h 40" stroke="#8d7b52" strokeWidth="1.6" opacity="0.7" strokeLinecap="round" />
    </svg>
  )
}

export function corkBoardPattern() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">
      <defs>
        <filter id="cbx">
          <feTurbulence type="fractalNoise" baseFrequency="0.05 0.1" numOctaves="5" seed="21" />
          <feColorMatrix type="matrix"
            values="0 0 0 0 0.62
                    0 0 0 0 0.42
                    0 0 0 0 0.23
                    0 0 0 0.5 0" result="co" />
          <feComposite operator="over" in2="SourceGraphic" />
        </filter>
      </defs>
      <rect width="240" height="240" fill="#a9743f" />
      <rect width="240" height="240" filter="url(#cbx)" opacity="0.9" />
      {Array.from({ length: 26 }).map((_, i) => (
        <line
          key={i}
          x1={(i * 47) % 240} y1={(i * 13) % 240} x2={(i * 47 + 13) % 240} y2={(i * 13) % 240}
          stroke="#5f3817" strokeOpacity="0.18" strokeWidth="1.6" strokeLinecap="round"
        />
      ))}
    </svg>
  )
}