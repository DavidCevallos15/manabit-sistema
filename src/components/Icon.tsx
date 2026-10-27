const paths: Record<string, string> = {
  home: "M3 11 12 3l9 8M5 10v11h5v-7h4v7h5V10",
  inbox: "M4 4h16v16H4zM4 13h5l2 3h2l2-3h5",
  calendar: "M4 5h16v16H4zM8 3v4M16 3v4M4 10h16M8 14h2M14 14h2M8 18h2",
  agents: "M9 3h6v6H9zM3 17h6v5H3zM15 17h6v5h-6zM12 9v4M6 17v-4h12v4",
  channels:
    "M8 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM22 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM15 19a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM6 8l4 8M18 8l-4 8M8 5h8",
  settings: "M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6",
  arrow: "M4 12h16M14 6l6 6-6 6",
  back: "M20 12H4M10 6l-6 6 6 6",
  external: "M14 3h7v7M21 3 10 14M10 3H3v18h18v-7",
  send: "m3 3 18 9-18 9 4-9-4-9ZM7 12h14",
  check: "m5 12 4 4L19 6",
  close: "m6 6 12 12M18 6 6 18",
  menu: "M4 6h16M4 12h16M4 18h16",
  clock: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  sun: "M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  moon: "M21 13a9 9 0 0 1-10-10 9 9 0 1 0 10 10Z",
  plus: "M12 4v16M4 12h16",
};
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.inbox} />
    </svg>
  );
}
