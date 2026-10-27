import type { Metadata } from "next";
import "@fontsource-variable/bricolage-grotesque/opsz.css";
import "./globals.css";
export const metadata: Metadata = {
  title: "Manabit Sistema · Recepción y agenda",
  description:
    "Centro de atención y diagnósticos de Manabit, by David Cevallos.",
  robots: { index: false, follow: false },
  icons: { icon: "/favicon.svg" },
};
const theme =
  "try{document.documentElement.dataset.theme=localStorage.getItem('manabit-system-theme')||'light'}catch(e){}";
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: theme }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
