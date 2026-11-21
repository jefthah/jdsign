import type { ReactNode } from "react";

/** 24×24 outline icon frame shared by the account and admin icons. */
export function Icon({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function OverviewIcon() {
  return (
    <Icon>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </Icon>
  );
}

export function ReceiptIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
      <path d="M9.5 8h5M9.5 12h5" />
    </Icon>
  );
}

export function DownloadIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5" />
      <path d="M4.5 16.5v1.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-1.5" />
    </Icon>
  );
}

export function HeartIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M12 20s-7.5-4.6-7.5-10.1A4.4 4.4 0 0 1 12 7.2a4.4 4.4 0 0 1 7.5 2.7C19.5 15.4 12 20 12 20z" />
    </Icon>
  );
}

export function UserIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </Icon>
  );
}

export function LogoutIcon() {
  return (
    <Icon>
      <path d="M14 4h3.5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H14" />
      <path d="M10 16.5 5.5 12 10 7.5M5.5 12H15" />
    </Icon>
  );
}

export function ChevronDownIcon() {
  return (
    <Icon size={16}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}

export function ArrowRightIcon({ size = 18 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M4 12h16m-6-6 6 6-6 6" />
    </Icon>
  );
}

export function ArrowUpRightIcon() {
  return (
    <Icon size={18}>
      <path d="M7 17 17 7M8 7h9v9" />
    </Icon>
  );
}

export function ShieldIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M12 3.5 5 6v5.5c0 4.3 3 7.6 7 9 4-1.4 7-4.7 7-9V6z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </Icon>
  );
}

export function MailIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
      <path d="m4.5 7 7.5 6 7.5-6" />
    </Icon>
  );
}
