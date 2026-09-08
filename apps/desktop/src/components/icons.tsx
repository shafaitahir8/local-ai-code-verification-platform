import type { SVGProps } from 'react';

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'>;

function IconFrame({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M3 7.5h6l2-2h4l2 2h4v11H3z" />
      <path d="M3 10h18" />
    </IconFrame>
  );
}

export function BranchIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="6" cy="5" r="2" />
      <circle cx="18" cy="7" r="2" />
      <circle cx="6" cy="19" r="2" />
      <path d="M6 7v10M8 11h4a6 6 0 0 0 6-2" />
    </IconFrame>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="m9 7 8 5-8 5z" />
    </IconFrame>
  );
}

export function StopIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <rect x="7" y="7" width="10" height="10" rx="1" />
    </IconFrame>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M20 7v5h-5" />
      <path d="M4 17v-5h5" />
      <path d="M6.1 9a7 7 0 0 1 11.5-2.1L20 12M4 12l2.4 5.1A7 7 0 0 0 17.9 15" />
    </IconFrame>
  );
}

export function TerminalIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 9 3 3-3 3M13 15h4" />
    </IconFrame>
  );
}

export function HistoryIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M4 5v5h5" />
      <path d="M5.3 16a8 8 0 1 0 .7-9l-2 3" />
      <path d="M12 8v4l3 2" />
    </IconFrame>
  );
}

export function FileIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v5h5" />
    </IconFrame>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M12 3 4.5 6v5.5c0 4.5 3 7.8 7.5 9.5 4.5-1.7 7.5-5 7.5-9.5V6z" />
      <path d="m9 12 2 2 4-5" />
    </IconFrame>
  );
}

export function ChevronIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="m9 6 6 6-6 6" />
    </IconFrame>
  );
}
