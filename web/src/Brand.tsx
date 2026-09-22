type BrandProps = { compact?: boolean; className?: string };

export function BrandLogo({ compact = false, className = '' }: BrandProps) {
  return (
    <span className={`brand-lockup ${compact ? 'compact' : ''} ${className}`.trim()}>
      <svg className="brand-symbol" viewBox="0 0 92 72" aria-hidden="true">
        <path d="M43 10a25 25 0 1 0 18 43" fill="none" stroke="#0753b8" strokeWidth="12" />
        <path d="M55 12h10a22 22 0 0 1 0 44H54" fill="none" stroke="#078ff0" strokeWidth="12" />
        <path d="M28 34h17l21 22H49z" fill="#08d5ca" />
      </svg>
      <span className="brand-wordmark">
        <span className="brand-name">Quetzal<span>Tech</span></span>
        <span className="brand-drive">D R I V E</span>
      </span>
    </span>
  );
}

export function DriveIllustration() {
  return (
    <svg className="drive-illustration" viewBox="0 0 360 230" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="folder-back" x1="102" y1="62" x2="273" y2="199" gradientUnits="userSpaceOnUse">
          <stop stopColor="#087bf1" stopOpacity=".42" />
          <stop offset="1" stopColor="#0743a5" stopOpacity=".13" />
        </linearGradient>
        <linearGradient id="folder-front" x1="111" y1="81" x2="231" y2="194" gradientUnits="userSpaceOnUse">
          <stop stopColor="#168cf7" stopOpacity=".92" />
          <stop offset="1" stopColor="#0653c7" stopOpacity=".62" />
        </linearGradient>
        <linearGradient id="cloud-fill" x1="203" y1="93" x2="258" y2="170" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" />
          <stop offset="1" stopColor="#9bdcff" />
        </linearGradient>
        <filter id="folder-glow" x="67" y="22" width="274" height="212" colorInterpolationFilters="sRGB" filterUnits="userSpaceOnUse">
          <feGaussianBlur stdDeviation="20" />
        </filter>
      </defs>
      <ellipse cx="209" cy="152" rx="91" ry="47" fill="#087bf1" fillOpacity=".42" filter="url(#folder-glow)" />
      <path d="M83 76a12 12 0 0 1 12-12h53l18 19h99a12 12 0 0 1 12 12v91a12 12 0 0 1-12 12H95a12 12 0 0 1-12-12V76Z" fill="url(#folder-back)" stroke="#2c8cf1" strokeOpacity=".42" />
      <path d="M104 91a12 12 0 0 1 12-12h43l16 17h102a12 12 0 0 1 12 12v77a12 12 0 0 1-12 12H116a12 12 0 0 1-12-12V91Z" fill="#0b2b5b" stroke="#36a1ff" strokeOpacity=".6" />
      <path d="M123 106a11 11 0 0 1 11-11h41l14 15h72a11 11 0 0 1 11 11v62a11 11 0 0 1-11 11h-127a11 11 0 0 1-11-11v-77Z" fill="url(#folder-front)" stroke="#64b7ff" strokeOpacity=".82" />
      <path d="M205 128c2-15 14-25 28-25 15 0 27 11 28 26 12 2 21 12 21 24 0 13-11 24-25 24h-53c-13 0-23-10-23-23 0-12 10-23 24-26Z" fill="url(#cloud-fill)" />
      <path d="m228 151 9-10 9 10m-9-9v25" stroke="#0876d9" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="72" cy="60" r="3" fill="#12d2cb" />
      <circle cx="307" cy="74" r="4" fill="#158fff" />
      <circle cx="291" cy="211" r="2.5" fill="#8fe4ff" />
    </svg>
  );
}
