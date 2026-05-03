// Shared icons used across EventPage, PlayerHub, RegistrationTimeline,
// and PlayerHubProgress. Stroke is hard-coded brand-green so consumers
// can drop them in without wrapping. All icons accept an optional `size`
// prop that overrides width/height for crisp rendering at any pixel size.

const TIMELINE_ICON_PROPS = {
  viewBox: '0 0 32 32',
  fill: 'none',
  stroke: '#00FF41',
  strokeWidth: 2.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export const PersonIcon = ({ size = 28 }) => (
  <svg width={size} height={size} {...TIMELINE_ICON_PROPS}>
    <circle cx="16" cy="11" r="5" />
    <path d="M5 28 C5 20 9 17 16 17 C23 17 27 20 27 28" />
  </svg>
)

export const TeamShieldIcon = ({ size = 28 }) => (
  <svg width={size} height={size} {...TIMELINE_ICON_PROPS}>
    <path d="M16 4 L27 8 V16 C27 22 22 27 16 29 C10 27 5 22 5 16 V8 Z" />
    <circle cx="12" cy="14" r="1.5" fill="#00FF41" stroke="none" />
    <circle cx="20" cy="14" r="1.5" fill="#00FF41" stroke="none" />
    <circle cx="16" cy="20" r="1.5" fill="#00FF41" stroke="none" />
  </svg>
)

export const CocDocumentIcon = ({ size = 28 }) => (
  <svg width={size} height={size} {...TIMELINE_ICON_PROPS}>
    <path d="M9 4 H20 L24 8 V28 H9 Z" />
    <line x1="13" y1="13" x2="21" y2="13" />
    <line x1="13" y1="18" x2="21" y2="18" />
    <line x1="13" y1="23" x2="19" y2="23" />
  </svg>
)

export const RefTestIcon = ({ size = 28 }) => (
  <svg width={size} height={size} {...TIMELINE_ICON_PROPS}>
    <rect x="7" y="6" width="18" height="22" rx="2" />
    <rect x="12" y="3" width="8" height="5" rx="1" />
    <path d="M11 17 L14 20 L21 13" />
  </svg>
)

export const CameraIcon = ({ size = 28 }) => (
  <svg width={size} height={size} {...TIMELINE_ICON_PROPS}>
    <path d="M11 9 L13 6 H19 L21 9" />
    <rect x="4" y="9" width="24" height="17" rx="2" />
    <circle cx="16" cy="17" r="5" />
  </svg>
)

export const SideEventsIcon = ({ size = 28 }) => (
  <svg width={size} height={size} {...TIMELINE_ICON_PROPS}>
    <circle cx="11" cy="11" r="5" />
    <circle cx="21" cy="13" r="5" />
    <circle cx="14" cy="22" r="5" />
  </svg>
)

export const PaymentIcon = ({ size = 28 }) => (
  <svg width={size} height={size} {...TIMELINE_ICON_PROPS}>
    <rect x="4" y="8" width="24" height="16" rx="2" />
    <line x1="4" y1="13" x2="28" y2="13" />
    <line x1="9" y1="19" x2="13" y2="19" />
  </svg>
)

export const TargetIcon = ({ size = 28 }) => (
  <svg width={size} height={size} {...TIMELINE_ICON_PROPS}>
    <circle cx="16" cy="16" r="11" />
    <circle cx="16" cy="16" r="7" />
    <circle cx="16" cy="16" r="3" fill="#00FF41" stroke="none" />
  </svg>
)

export const DashboardGridIcon = ({ size = 64 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="8" y="8" width="22" height="22" rx="3" stroke="#00FF41" strokeWidth="2.5" fill="none"/>
    <rect x="34" y="8" width="22" height="22" rx="3" stroke="#00FF41" strokeWidth="2.5" fill="none"/>
    <rect x="8" y="34" width="22" height="22" rx="3" stroke="#00FF41" strokeWidth="2.5" fill="none"/>
    <rect x="34" y="34" width="22" height="22" rx="3" stroke="#00FF41" strokeWidth="2.5" fill="none"/>
    <line x1="15" y1="19" x2="23" y2="19" stroke="#00FF41" strokeWidth="1.5" strokeLinecap="round"/>
    <line x1="41" y1="15" x2="49" y2="15" stroke="#00FF41" strokeWidth="1.5" strokeLinecap="round"/>
    <line x1="41" y1="19" x2="46" y2="19" stroke="#00FF41" strokeWidth="1.5" strokeLinecap="round"/>
    <line x1="41" y1="23" x2="49" y2="23" stroke="#00FF41" strokeWidth="1.5" strokeLinecap="round"/>
    <circle cx="19" cy="45" r="5" stroke="#00FF41" strokeWidth="2" fill="none"/>
    <path d="M41 45 L49 45 M41 41 L49 41 M41 49 L46 49" stroke="#00FF41" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
)
