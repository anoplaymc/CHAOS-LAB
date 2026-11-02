/** Small hand-drawn previews. Packs without art get a neutral tile. */
export function MapArt({ id }: { id: string }) {
  switch (id) {
    case 'test_facility':
      return (
        <svg className="map-art" viewBox="0 0 160 80" aria-hidden="true">
          <rect width="160" height="80" fill="#1b2a30" />
          <polygon points="0,80 160,80 120,46 40,46" fill="#5b6268" />
          <rect x="40" y="16" width="80" height="30" fill="#2f3f47" />
          <rect x="40" y="36" width="80" height="10" fill="#a8aca2" />
          <rect x="66" y="6" width="28" height="3" fill="#fff" />
          <rect x="30" y="10" width="20" height="2" fill="#fff" opacity=".6" />
          <rect x="110" y="10" width="20" height="2" fill="#fff" opacity=".6" />
          <rect x="70" y="50" width="9" height="9" fill="#c0935a" />
          <rect x="80" y="50" width="9" height="9" fill="#c0935a" />
          <rect x="75" y="41" width="9" height="9" fill="#c0935a" />
          <rect x="108" y="46" width="24" height="3" fill="#ffb000" />
          <rect x="24" y="52" width="16" height="9" fill="#19a596" />
        </svg>
      );
    case 'industrial_yard':
      return (
        <svg className="map-art" viewBox="0 0 160 80" aria-hidden="true">
          <defs><linearGradient id="yd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3a6ea5" /><stop offset="1" stopColor="#d8c8a8" /></linearGradient></defs>
          <rect width="160" height="50" fill="url(#yd)" />
          <rect y="50" width="160" height="30" fill="#2d2f31" />
          <rect x="6" y="22" width="56" height="28" fill="#1e6a70" />
          <polygon points="4,22 64,22 58,16 10,16" fill="#6e7c80" />
          <rect x="26" y="36" width="16" height="14" fill="#0d1417" />
          <rect x="82" y="38" width="36" height="12" fill="#a33a2a" />
          <rect x="82" y="26" width="36" height="12" fill="#25527f" />
          <rect x="120" y="38" width="36" height="12" fill="#c98310" />
          <rect x="78" y="56" width="4" height="10" fill="#ffb000" />
          <rect x="78" y="70" width="4" height="10" fill="#ffb000" />
        </svg>
      );
    case 'gravity_playground':
      return (
        <svg className="map-art" viewBox="0 0 160 80" aria-hidden="true">
          <defs><linearGradient id="gp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2b1f6b" /><stop offset="1" stopColor="#e87ab0" /></linearGradient></defs>
          <rect width="160" height="80" fill="url(#gp)" />
          <polygon points="50,52 110,52 96,64 64,64" fill="#3a4a78" />
          <rect x="46" y="48" width="68" height="5" fill="#1f8d84" />
          <rect x="10" y="60" width="26" height="4" fill="#3a4a78" />
          <rect x="124" y="30" width="28" height="4" fill="#1f8d84" />
          <rect x="72" y="16" width="20" height="3" fill="#3a4a78" />
          <rect x="74" y="20" width="16" height="28" fill="#8a50ff" opacity=".35" />
          <circle cx="82" cy="38" r="3" fill="#ffb000" />
          <circle cx="24" cy="50" r="3" fill="#ffb000" />
          <rect x="88" y="44" width="16" height="4" fill="#ff4fa3" />
        </svg>
      );
    default:
      return (
        <svg className="map-art" viewBox="0 0 160 80" aria-hidden="true">
          <rect width="160" height="80" fill="#24384a" />
          <polygon points="0,80 160,80 110,44 50,44" fill="#1f8d84" />
          <rect x="60" y="30" width="40" height="14" fill="#a33a2a" />
        </svg>
      );
  }
}
