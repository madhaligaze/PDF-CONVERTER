import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin", "cyrillic"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Управленческий учёт финансов",
  description: "Интеллектуальный анализ банковских выписок и экспорт в Excel.",
};

/**
 * Вьюпорт: масштаб не запрещаем, безопасные зоны включаем.
 *
 * `maximumScale: 1` отнимал пинч-зум — а на телефоне это последний способ
 * прочитать плотную таблицу, и заодно нарушение WCAG 1.4.4.
 *
 * `viewportFit: "cover"` обязателен, а не украшение: без него iOS отдаёт во все
 * `env(safe-area-inset-*)` ноль, и вся вёрстка вокруг «чёлки» и домашней
 * полоски молча превращается в пустые отступы.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/* Prevent flash-of-wrong-theme: runs before React hydration */
const themeScript = `
(function(){
  try {
    var t = localStorage.getItem('theme');
    if (t === 'light' || t === 'dark') {
      document.documentElement.setAttribute('data-theme', t);
    } else {
      var dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    }
  } catch(e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ru"
      data-theme="dark"
      suppressHydrationWarning
      className={`${manrope.variable} ${plexMono.variable} antialiased`}
    >
      <head>
        <meta charSet="utf-8" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
