import type { EntryArt, EntryIcon } from '../../domain/whatsnew/entries';

/**
 * Les dessins des nouveautés : une illustration par entrée visuelle et une petite icône par entrée. Gabarits statiques,
 * sans donnée de l'utilisateur. Pas de dégradé ni d'identifiant : une même illustration peut apparaître deux fois dans la page.
 */

const SVG_OPEN = 'viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"';

export const ART: Record<EntryArt, string> = {
  rainbow: `<svg ${SVG_OPEN}>
    <rect width="400" height="260" fill="#14284A"/><rect y="130" width="400" height="130" fill="#1B3560" opacity=".6"/>
    <g fill="#fff"><circle cx="40" cy="30" r="1.6"/><circle cx="150" cy="22" r="1.2"/><circle cx="230" cy="48" r="1.6"/><circle cx="300" cy="20" r="1.2"/><circle cx="360" cy="70" r="1.6"/><circle cx="60" cy="110" r="1.2"/><circle cx="190" cy="90" r="1.2"/></g>
    <circle cx="130" cy="62" r="20" fill="#FFF3D6"/>
    <g fill="none" stroke-linecap="round" stroke-width="8">
      <path d="M-20 262C110 262 170 150 430 60" stroke="#FF2D55"/><path d="M-20 252C110 252 170 140 430 50" stroke="#FF7A1A"/>
      <path d="M-20 242C110 242 170 130 430 40" stroke="#FFD60A"/><path d="M-20 232C110 232 170 120 430 30" stroke="#1FE07F"/>
      <path d="M-20 222C110 222 170 110 430 20" stroke="#2E9BFF"/><path d="M-20 212C110 212 170 100 430 10" stroke="#9B6BFF"/>
    </g></svg>`,
  velodrome: `<svg ${SVG_OPEN}>
    <rect width="400" height="260" fill="#CFE3F2"/><rect y="150" width="400" height="110" fill="#8DBE7A"/>
    <rect x="50" y="60" width="300" height="150" rx="75" fill="#C98B5A"/><rect x="92" y="96" width="216" height="78" rx="39" fill="#7DB36B"/>
    <rect x="68" y="76" width="264" height="114" rx="57" fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="9 7" opacity=".85"/>
    <rect x="80" y="86" width="240" height="94" rx="47" fill="none" stroke="#C92A2A" stroke-width="2"/>
    <circle cx="120" cy="76" r="5" fill="#FF2D55"/><circle cx="136" cy="76" r="5" fill="#2E9BFF"/><circle cx="290" cy="190" r="5" fill="#FFD60A"/></svg>`,
  map: `<svg ${SVG_OPEN}>
    <rect width="400" height="260" fill="#F4EDE3"/>
    <g fill="none" stroke="#C9C1B3" stroke-width="9" stroke-linecap="round"><path d="M0 70L400 105"/><path d="M110 0L175 260"/><path d="M0 215L400 175"/></g>
    <path d="M175 260L150 140L235 115L400 105" fill="none" stroke="#C2410C" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="163" cy="185" r="16" fill="#fff" stroke="#14171A" stroke-width="6"/></svg>`,
  home: `<svg ${SVG_OPEN}>
    <rect width="400" height="260" fill="#EFE6D8"/><rect x="28" y="28" width="230" height="136" rx="16" fill="#BCD9EE"/>
    <rect x="28" y="180" width="50" height="54" rx="10" fill="#fff"/><rect x="88" y="180" width="50" height="54" rx="10" fill="#fff"/>
    <rect x="148" y="180" width="50" height="54" rx="10" fill="#fff"/><rect x="208" y="180" width="50" height="54" rx="10" fill="#fff"/>
    <rect x="276" y="28" width="96" height="206" rx="16" fill="#fff"/></svg>`,
};

const ICON_OPEN = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';

export const ICON: Record<EntryIcon, string> = {
  route: `<svg ${ICON_OPEN}><path d="M3 19l6-10 4 6 3-4 5 8z"/></svg>`,
  track: `<svg ${ICON_OPEN}><rect x="3" y="7" width="18" height="10" rx="5"/><rect x="7" y="10" width="10" height="4" rx="2"/></svg>`,
  map: `<svg ${ICON_OPEN}><path d="M12 21s6-5.5 6-10a6 6 0 10-12 0c0 4.5 6 10 6 10z"/><circle cx="12" cy="11" r="2"/></svg>`,
  sync: `<svg ${ICON_OPEN}><path d="M4 12a8 8 0 0113-6l2 2M20 12a8 8 0 01-13 6l-2-2"/><path d="M19 3v5h-5M5 21v-5h5"/></svg>`,
  sun: `<svg ${ICON_OPEN}><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/></svg>`,
  home: `<svg ${ICON_OPEN}><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/></svg>`,
  pause: `<svg ${ICON_OPEN}><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>`,
  layers: `<svg ${ICON_OPEN}><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/></svg>`,
};

const ICON_BOLD = ICON_OPEN.replace('stroke-width="1.8"', 'stroke-width="2"');

export const ICON_CLOSE = `<svg ${ICON_BOLD}><path d="M6 6l12 12M18 6L6 18"/></svg>`;
export const ICON_ARROW = `<svg ${ICON_BOLD}><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;
