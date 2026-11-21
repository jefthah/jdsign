import { Icon } from "@/components/account/icons";

export function StoreIcon() {
  return (
    <Icon>
      <path d="M4 9.5 5.5 4.5h13L20 9.5" />
      <path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0" />
      <path d="M5.5 12v7.5h13V12" />
      <path d="M10 19.5v-4h4v4" />
    </Icon>
  );
}

export function LayoutIcon() {
  return (
    <Icon>
      <rect x="3.5" y="4" width="17" height="16" rx="2.5" />
      <path d="M3.5 9h17M9.5 9v11" />
    </Icon>
  );
}

export function WalletIcon() {
  return (
    <Icon>
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17v3" />
      <rect x="4" y="8" width="16.5" height="11.5" rx="2.5" />
      <path d="M16 13.75h1.5" />
    </Icon>
  );
}

export function UsersIcon() {
  return (
    <Icon>
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M3 19.5c.8-3.1 3.2-5 6-5s5.2 1.9 6 5" />
      <path d="M15.5 5.3a3.5 3.5 0 0 1 0 6.4M17.5 14.8c1.7.7 3 2.4 3.5 4.7" />
    </Icon>
  );
}

export function TagIcon() {
  return (
    <Icon>
      <path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.5 1.5 0 0 1 0 2.1l-6.6 6.6a1.5 1.5 0 0 1-2.1 0z" />
      <circle cx="8" cy="8" r="1.3" />
    </Icon>
  );
}

export function ListIcon() {
  return (
    <Icon>
      <path d="M9 6.5h11M9 12h11M9 17.5h11" />
      <path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />
    </Icon>
  );
}
