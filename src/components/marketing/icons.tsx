/**
 * Every icon on the site, as inline SVG.
 *
 * No emoji anywhere: emoji render differently on every operating system, cannot
 * be recoloured, and look like a toy on a projector in front of executives.
 * These inherit `currentColor`, so a colour transition on hover is free.
 */

type IconProps = { className?: string };

const base = "h-full w-full";

function Svg({
  className,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? base}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** Register / capture a record. */
export function IconClipboard(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1Z" />
      <path d="M8 6H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-2" />
      <path d="m9 13 2 2 4-4" />
    </Svg>
  );
}

/** Location / map pin. */
export function IconPin(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.6" />
    </Svg>
  );
}

/** Add something that already exists in the world — a map pin with a plus. */
export function IconPinPlus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11Z" />
      <path d="M12 7.4v5.2M9.4 10h5.2" />
    </Svg>
  );
}

/** Transport / dispatch. */
export function IconTruck(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 7a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v9H3V7Z" />
      <path d="M14 10h3.4a1 1 0 0 1 .8.4l2.6 3.3a1 1 0 0 1 .2.6V16h-7v-6Z" />
      <circle cx="7" cy="18" r="2" />
      <circle cx="17.5" cy="18" r="2" />
      <path d="M9 18h6.5" />
    </Svg>
  );
}

/** Warranty / protection. */
export function IconShield(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.5 19 6v5.6c0 4.3-2.9 7.6-7 9-4.1-1.4-7-4.7-7-9V6l7-2.5Z" />
      <path d="m9 12 2 2 4-4" />
    </Svg>
  );
}

/** Camera / photographic evidence. */
export function IconCamera(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 8h3l1.4-2h7.2L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13.5" r="3.2" />
    </Svg>
  );
}

/** History / the story timeline. */
export function IconHistory(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3.5 4.5V9H8" />
      <path d="M12 7.5V12l3 1.8" />
    </Svg>
  );
}

/** Test / measurement. */
export function IconGauge(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 16a8 8 0 1 1 16 0" />
      <path d="M12 16l4-4" />
      <circle cx="12" cy="16" r="1.2" />
    </Svg>
  );
}

/** Dashboard / reporting. */
export function IconChart(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <path d="M8 20v-6" />
      <path d="M13 20V9" />
      <path d="M18 20v-9" />
    </Svg>
  );
}

/** Signing in. */
export function IconLogin(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4" />
      <path d="M10 8l4 4-4 4" />
      <path d="M14 12H4" />
    </Svg>
  );
}

export function IconArrowRight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12h13" />
      <path d="m12 6 6 6-6 6" />
    </Svg>
  );
}

export function IconChevronLeft(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m14 6-6 6 6 6" />
    </Svg>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m10 6 6 6-6 6" />
    </Svg>
  );
}

export function IconPause(props: IconProps) {
  return (
    <Svg {...props} >
      <rect x="8" y="6" width="2.6" height="12" rx="0.8" fill="currentColor" stroke="none" />
      <rect x="13.4" y="6" width="2.6" height="12" rx="0.8" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconPlay(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 6.5v11l9-5.5-9-5.5Z" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconArrowUp(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 19V6" />
      <path d="m6 12 6-6 6 6" />
    </Svg>
  );
}
