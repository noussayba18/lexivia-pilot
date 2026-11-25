import { useId } from 'react'
import s from './BrandLogo.module.css'

function Bulb() {
  return <g className={s.bulbTilt}><g fill="none" stroke="#F8B321" strokeWidth="3.5" strokeLinecap="round"><path d="M32 1v7M9 9l5 5M1 31h7M55 9l-5 5M56 31h7M5 49l7-4M59 49l-7-4"/></g><path d="M14 28a18 18 0 1 1 36 0c0 10-9 15-10 24H24c-1-9-10-14-10-24Z" fill="#F8B321"/><path d="M26 32l6 7 6-7M32 39v14" fill="none" stroke="#DB9A14" strokeWidth="2.5" strokeLinecap="round"/><path d="M23 52h18v13c0 7-18 7-18 0Z" fill="#73818B"/><path d="M24 57h16M24 63h16" stroke="#B2BDC1" strokeWidth="2"/><path d="M28 70h8" stroke="#53636D" strokeWidth="3" strokeLinecap="round"/></g>
}

/** Preserve the supplied compact artwork; unfold the lettering beside it. */
export default function BrandLogo({ compact = false, className = '' }) {
  const darkFilter = `logo-dark-${useId().replace(/:/g, '')}`
  return <span className={`${s.logo} ${compact ? s.compact : ''} ${className}`} style={{ '--logo-dark-filter': `url(#${darkFilter})` }} role="img" aria-label="Lexivia">
    <svg className={s.reference} viewBox="425 350 390 570" aria-hidden="true" focusable="false"><image href="/brand/lexivia-compact-reference.png" width="1254" height="1254"/></svg>
    <svg className={s.canvas} viewBox="290 145 2540 1050" aria-hidden="true" focusable="false">
      <defs>
        {/* Preserve teal/gold, lift navy ink, and remove the pale paper in dark mode. */}
        <filter id={darkFilter} colorInterpolationFilters="sRGB" x="-5%" y="-5%" width="110%" height="110%">
          <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  -1 -1 -1 2.65 0" result="clean"/>
          <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  -3 -3 -3 3.75 0" result="ink-mask"/>
          <feFlood floodColor="#edf1fa" result="light-ink"/>
          <feComposite in="light-ink" in2="ink-mask" operator="in" result="ink"/>
          <feMerge><feMergeNode in="clean"/><feMergeNode in="ink"/></feMerge>
        </filter>
      </defs>
      <image href="/brand/lexivia-frame.png" width="1254" height="1254"/>
      <g className={`${s.letter} ${s.e}`}><text>e</text></g>
      <g className={`${s.letter} ${s.x}`}><text>x</text></g>
      <g className={s.bulb}><Bulb/></g>
      <g className={`${s.letter} ${s.v}`}><text>v</text></g>
      <g className={`${s.letter} ${s.i}`}><text>i</text></g>
      <g className={`${s.letter} ${s.a}`}><text>a</text></g>
    </svg>
  </span>
}
