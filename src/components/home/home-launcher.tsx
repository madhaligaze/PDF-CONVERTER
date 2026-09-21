"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { ClockIcon, GridIcon, PuzzleIcon, TableIcon } from "@/components/icons";

type Tile = {
  href: string;
  label: string;
  corner: "tl" | "tr" | "bl" | "br";
  Icon: typeof TableIcon;
};

const TILES: Tile[] = [
  {
    href: "/analyzer",
    label: "Анализатор выписок",
    corner: "tl",
    Icon: TableIcon,
  },
  {
    href: "/services",
    label: "Сервисы",
    corner: "tr",
    Icon: PuzzleIcon,
  },
  {
    href: "/web-excel",
    label: "Таблицы",
    corner: "bl",
    Icon: GridIcon,
  },
  {
    href: "/history",
    label: "История",
    corner: "br",
    Icon: ClockIcon,
  },
];

type Props = {
  /** Адрес ролика. Пусто — фон остаётся градиентным. */
  videoSrc?: string;
};

/**
 * Стартовый экран: четыре плитки, слетающиеся из углов на фоне видео.
 *
 * Ролик один на обе темы. Читаемость подписей держит не он, а вуаль
 * `.home-veil` поверх него — она своя для светлой и тёмной темы, поэтому
 * второе видео ничего не добавляло бы, кроме второй ссылки, которую надо
 * не забыть поменять.
 *
 * Адрес приходит из окружения, а не лежит в репозитории: коммитить десятки
 * мегабайт в git ради фона значит навсегда утяжелить каждый клон. Пока
 * переменной нет, фон — тот же градиент `--page-bg`, что и на остальных
 * экранах, и стартовая страница выглядит законченной, а не сломанной.
 */
export function HomeLauncher({ videoSrc = "" }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Битый адрес прячет ролик целиком, а не оставляет чёрный прямоугольник
  // поверх светлой темы: ссылку на бакет будут менять руками, и опечатка в
  // ней не должна ломать вид стартового экрана.
  //
  // Ради этого же адрес стоит атрибутом `src`, а не вложенным <source>: на
  // <source> событие error всплывает не до <video>, и обработчик ниже просто
  // никогда бы не сработал.
  const [broken, setBroken] = useState(false);
  const src = broken ? "" : videoSrc;

  useEffect(() => {
    const node = videoRef.current;
    if (!node || !src) return;

    // Одного onError мало, и это не перестраховка. Разметку отдаёт сервер,
    // браузер начинает грузить ролик сразу — а React навешивает обработчик
    // только после гидратации. Битый адрес успевает отвалиться в этот
    // промежуток, событие уходит в никуда, и на экране остаётся чёрный
    // прямоугольник, которого обработчик как раз и должен был не допустить.
    // Поэтому состояние элемента проверяется ещё и здесь, задним числом.
    // Правило про setState в эффекте здесь не к месту: это разовая поправка
    // состояния, которое уже сложилось в DOM до гидратации, а не подписка и не
    // каскад. Без неё обработчик onError ниже ловит только те отказы, что
    // случились после гидратации, — то есть как раз не тот случай, ради
    // которого он написан.
    if (node.error) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBroken(true);
      return;
    }

    void node.play().catch(() => {
      /* автозапуск может быть запрещён политикой браузера — фон просто статичен */
    });
  }, [src]);

  return (
    <div className="home-stage">
      {src ? (
        <video
          ref={videoRef}
          className="home-video"
          src={src}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden="true"
          tabIndex={-1}
          onError={() => setBroken(true)}
        />
      ) : null}
      <div className="home-veil" aria-hidden="true" />

      {/* В шапке стартового экрана только переключатель темы. Значок и подпись
          «BBC Consulting» отсюда убраны: разделы — четыре плитки посреди
          экрана, и всё, что стоит вокруг них, соревнуется с ними за внимание,
          ничего при этом не сообщая. */}
      <header className="home-top">
        <HomeThemeToggle />
      </header>

      <main className="home-grid">
        {TILES.map((tile, index) => (
          <Link
            key={tile.href}
            href={tile.href}
            className="home-tile"
            data-corner={tile.corner}
            style={{ animationDelay: `calc(var(--home-delay) + ${index * 60}ms)` }}
          >
            <span className="home-tile-icon">
              <tile.Icon size={22} />
            </span>
            <span className="home-tile-label">{tile.label}</span>
          </Link>
        ))}
      </main>
    </div>
  );
}

/**
 * Переключатель темы на стартовом экране.
 *
 * Копия того, что стоит в шапке анализатора, а не общий компонент — намеренно:
 * тот живёт внутри WorkbenchProvider и тянет за собой весь контекст разбора
 * выписок, которому на стартовом экране делать нечего.
 */
function HomeThemeToggle() {
  const [label, setLabel] = useState("Авто");

  useEffect(() => {
    try {
      const stored = localStorage.getItem("theme");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLabel(stored === "dark" ? "Тёмная" : stored === "light" ? "Светлая" : "Авто");
    } catch {
      /* приватный режим — остаётся «Авто» */
    }
  }, []);

  const cycle = () => {
    try {
      const stored = localStorage.getItem("theme");
      const next = stored === "dark" ? "light" : stored === "light" ? null : "dark";
      if (next === null) {
        localStorage.removeItem("theme");
        const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
        setLabel("Авто");
      } else {
        localStorage.setItem("theme", next);
        document.documentElement.setAttribute("data-theme", next);
        setLabel(next === "dark" ? "Тёмная" : "Светлая");
      }
    } catch {
      /* приватный режим — тема не запоминается */
    }
  };

  return (
    <button type="button" className="btn-ghost text-xs px-2.5 py-1.5" onClick={cycle}>
      {label}
    </button>
  );
}
