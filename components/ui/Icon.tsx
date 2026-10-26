"use client";
import type { SVGProps } from "react";

/**
 * Tiny inline-SVG icon set — no external icon library, no emoji.
 * Icons use currentColor so they inherit text color.
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number; title?: string };

function Base({ size = 18, title, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export const Icon = {
  Search: (p: IconProps) => (
    <Base {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Base>
  ),
  Plus: (p: IconProps) => (
    <Base {...p}><path d="M12 5v14M5 12h14" /></Base>
  ),
  Minus: (p: IconProps) => (
    <Base {...p}><path d="M5 12h14" /></Base>
  ),
  X: (p: IconProps) => (
    <Base {...p}><path d="M6 6l12 12M18 6 6 18" /></Base>
  ),
  Check: (p: IconProps) => (
    <Base {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Base>
  ),
  Alert: (p: IconProps) => (
    <Base {...p}><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" /></Base>
  ),
  Info: (p: IconProps) => (
    <Base {...p}><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></Base>
  ),
  Refresh: (p: IconProps) => (
    <Base {...p}><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></Base>
  ),
  Eye: (p: IconProps) => (
    <Base {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></Base>
  ),
  EyeOff: (p: IconProps) => (
    <Base {...p}><path d="M3 3l18 18" /><path d="M10.6 6.1A10.5 10.5 0 0 1 12 6c6.5 0 10 6 10 6a16.7 16.7 0 0 1-3.2 4" /><path d="M6.6 6.6A16.6 16.6 0 0 0 2 12s3.5 7 10 7a10.6 10.6 0 0 0 5.4-1.4" /><path d="M14.1 14.1A3 3 0 0 1 9.9 9.9" /></Base>
  ),
  ChevronLeft: (p: IconProps) => (
    <Base {...p}><path d="m15 6-6 6 6 6" /></Base>
  ),
  ChevronRight: (p: IconProps) => (
    <Base {...p}><path d="m9 6 6 6-6 6" /></Base>
  ),
  ChevronDown: (p: IconProps) => (
    <Base {...p}><path d="m6 9 6 6 6-6" /></Base>
  ),
  ArrowRight: (p: IconProps) => (
    <Base {...p}><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></Base>
  ),
  Cart: (p: IconProps) => (
    <Base {...p}><circle cx="9" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" /><path d="M3 4h2l2.7 11.4a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6" /></Base>
  ),
  Receipt: (p: IconProps) => (
    <Base {...p}><path d="M5 3v18l3-2 3 2 3-2 3 2 3-2V3" /><path d="M8 8h8M8 12h8M8 16h6" /></Base>
  ),
  Chef: (p: IconProps) => (
    <Base {...p}><path d="M6 16h12v3a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1Z" /><path d="M8 16V8a4 4 0 0 1 8 0v8" /><path d="M6 11h12" /></Base>
  ),
  Cash: (p: IconProps) => (
    <Base {...p}><rect x="2.5" y="6" width="19" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M5.5 9.5h.01M18.5 14.5h.01" /></Base>
  ),
  Phone: (p: IconProps) => (
    <Base {...p}><path d="M22 16.92V21a1 1 0 0 1-1.1 1A19 19 0 0 1 2 4.1 1 1 0 0 1 3 3h4.1a1 1 0 0 1 1 .75l1.2 4.4a1 1 0 0 1-.27 1L7 11a16 16 0 0 0 6 6l1.85-1.95a1 1 0 0 1 1-.27l4.4 1.2a1 1 0 0 1 .75 1Z" /></Base>
  ),
  User: (p: IconProps) => (
    <Base {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></Base>
  ),
  Logout: (p: IconProps) => (
    <Base {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></Base>
  ),
  Wifi: (p: IconProps) => (
    <Base {...p}><path d="M5 12.55a11 11 0 0 1 14 0" /><path d="M1.42 9a16 16 0 0 1 21.16 0" /><path d="M8.53 16.11a6 6 0 0 1 6.95 0" /><path d="M12 20h.01" /></Base>
  ),
  WifiOff: (p: IconProps) => (
    <Base {...p}><path d="M1 1l22 22" /><path d="M16.72 11.06A11 11 0 0 1 19 12.55" /><path d="M5 12.55a11 11 0 0 1 5.17-2.39" /><path d="M10.71 5.05A16 16 0 0 1 22.58 9" /><path d="M1.42 9a15.93 15.93 0 0 1 4.7-2.88" /><path d="M8.53 16.11a6 6 0 0 1 6.95 0" /><path d="M12 20h.01" /></Base>
  ),
  Sparkle: (p: IconProps) => (
    <Base {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" /></Base>
  ),
  QrCode: (p: IconProps) => (
    <Base {...p}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3M20 14v3M14 20h3M20 20h1" /></Base>
  ),
  Clock: (p: IconProps) => (
    <Base {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Base>
  ),
  Flame: (p: IconProps) => (
    <Base {...p}><path d="M12 2s4 4.5 4 8a4 4 0 0 1-8 0c0-1.5.7-2.7 1.5-3.5C9 8 9 9 10 10c.5-3 2-5 2-8Z" /><path d="M7 14a5 5 0 0 0 10 0c0-1.5-.5-2.6-1.2-3.4" /></Base>
  ),
  Bell: (p: IconProps) => (
    <Base {...p}><path d="M6 8a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" /><path d="M10 19a2 2 0 0 0 4 0" /></Base>
  ),
  Store: (p: IconProps) => (
    <Base {...p}><path d="M3 9 5 4h14l2 5" /><path d="M3 9v10a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V9" /><path d="M3 9h18" /><path d="M9 14h6" /></Base>
  ),
  Utensils: (p: IconProps) => (
    <Base {...p}><path d="M6 2v8a2 2 0 0 0 2 2v8" /><path d="M6 2c0 4 1 7 4 7" /><path d="M18 2c-1.5 0-3 1-3 4v6h3v8" /></Base>
  ),
  Edit: (p: IconProps) => (
    <Base {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" /></Base>
  ),
  Chart: (p: IconProps) => (
    <Base {...p}><path d="M3 3v18h18" /><path d="M7 14l4-4 4 4 5-6" /></Base>
  ),
  Upload: (p: IconProps) => (
    <Base {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 9 5-5 5 5" /><path d="M12 4v12" /></Base>
  ),
  Filter: (p: IconProps) => (
    <Base {...p}><path d="M3 4h18l-7 9v6l-4-2v-4Z" /></Base>
  ),
};
