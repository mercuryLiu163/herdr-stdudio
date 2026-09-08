export function IconTerminal({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
      <path d="M4.5 6l2.5 2-2.5 2M8.5 10.5h3" />
    </svg>
  );
}

export function IconSend({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 8l12-6-4.5 12L7 9.5 2 8z" />
    </svg>
  );
}

export function IconLayers({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1.5L14.5 5 8 8.5 1.5 5 8 1.5z" />
      <path d="M1.5 8.5L8 12l6.5-3.5M1.5 11.5L8 15l6.5-3.5" />
    </svg>
  );
}

export function IconBot({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="5" width="11" height="8.5" rx="2" />
      <path d="M8 5V2.5M5 9h.01M11 9h.01M5.5 11.5h5" />
      <circle cx="8" cy="2.5" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconGear({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" />
    </svg>
  );
}

export function IconMinimize() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.2">
      <path d="M1 5h8" />
    </svg>
  );
}

export function IconMaximize() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
      <rect x="1" y="1" width="8" height="8" rx="1" />
    </svg>
  );
}

export function IconClose() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.2">
      <path d="M1 1l8 8M9 1l-8 8" />
    </svg>
  );
}

export function IconBook({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3.5C6.5 2.3 4.5 2 2 2v10.5c2.5 0 4.5.3 6 1.5 1.5-1.2 3.5-1.5 6-1.5V2c-2.5 0-4.5.3-6 1.5z" />
      <path d="M8 3.5V14" />
    </svg>
  );
}
