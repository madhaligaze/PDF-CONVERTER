import type { Metadata, Viewport } from "next";
import { Inter, Literata, Unbounded } from "next/font/google";

import { StageTransitionProvider } from "@/components/motion/stage-transition";
import "./globals.css";

/**
 * Forner называет гарнитуры Surt, Clash Display и Big Daily Short.
 * У них нет кириллицы, а интерфейс русский, поэтому стоят замены с тем же
 * характером: Inter — основной гротеск, Unbounded — архитектурные заголовки,
 * курсив Literata — редкая помета.
 */
const surt = Inter({
  variable: "--font-surt-family",
  subsets: ["latin", "cyrillic"],
  weight: "400",
  display: "swap",
});

const clash = Unbounded({
  variable: "--font-clashdisplay-family",
  subsets: ["latin", "cyrillic"],
  weight: "400",
  display: "swap",
});

const note = Literata({
  variable: "--font-bigdailyshort-family",
  subsets: ["latin", "cyrillic"],
  weight: "400",
  style: "italic",
  display: "swap",
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
  themeColor: "#faf5eb",
};

/*
 * До гидратации: тема (чтобы не мигнула чужая) и класс `motion`.
 *
 * `motion` прячет надписи, которые потом выедут анимацией, — иначе сервер
 * отдаёт их на месте, а после гидратации они пропадают и выезжают заново.
 * Ставится только если человек не просил меньше движения. Через четыре секунды
 * класс снимается сам: если JS не доехал, текст не может остаться невидимым.
 * Когда JS доехал, это ни на что не влияет — к этому моменту начальные
 * состояния держит уже GSAP инлайновыми стилями.
 */
const bootScript = `
(function(){
  var html = document.documentElement;
  try {
    var t = localStorage.getItem('theme');
    if (t === 'light' || t === 'dark') {
      html.setAttribute('data-theme', t);
    } else if (t === 'system') {
      var dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      html.setAttribute('data-theme', dark ? 'dark' : 'light');
    } else {
      html.setAttribute('data-theme', 'light');
    }
  } catch(e) {}
  try {
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      html.classList.add('motion');
      setTimeout(function(){ html.classList.remove('motion'); }, 4000);
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
      data-theme="light"
      suppressHydrationWarning
      className={`${surt.variable} ${clash.variable} ${note.variable} antialiased`}
    >
      <head>
        <meta charSet="utf-8" />
        <script dangerouslySetInnerHTML={{ __html: bootScript }} />
      </head>
      <body>
        <StageTransitionProvider>{children}</StageTransitionProvider>
      </body>
    </html>
  );
}
