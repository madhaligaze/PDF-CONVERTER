"use client";

import type { ReactNode } from "react";

import { ArrowLeftIcon } from "@/components/icons";
import { LiquidStage } from "@/components/motion/liquid-stage";
import { SplitReveal } from "@/components/motion/split-reveal";
import { StageLink } from "@/components/motion/stage-transition";

type Props = {
  /** Чей это вход — подпись в фигурных скобках над заголовком. */
  owner: string;
  /** Крупный заголовок на афише: куда человек входит. */
  title: string;
  /** Куда ведёт стрелка назад. Нет — стрелки нет. */
  backHref?: string;
  backLabel?: string;
  children: ReactNode;
};

/**
 * Экран входа: афиша слева, форма справа.
 *
 * Раньше вход был карточкой посреди пустого экрана — самая частая форма в
 * чужих продуктах, и по ней продукт не узнать. Здесь экран поделён: слева
 * тёмная афиша с жидкой сценой и названием раздела во весь рост, справа —
 * форма на обычной поверхности темы. На телефоне афиша становится полосой
 * сверху, а форма остаётся на первом экране: ради неё сюда и пришли.
 *
 * Общий для трёх разделов — дашборда BBC, «Финансов» и «Таблиц». Разделы
 * задуманы удаляемыми, поэтому здесь нет ни одного их импорта: раздел
 * передаёт надписи и форму, экран про разделы ничего не знает.
 */
export function AuthStage({ owner, title, backHref, backLabel = "Разделы", children }: Props) {
  return (
    <div className="auth-stage">
      <section className="auth-poster" aria-hidden="false">
        <LiquidStage className="auth-liquid" intensity={0.95} delay={0.1} />
        <div className="auth-poster-veil" aria-hidden="true" />
        {backHref ? (
          <StageLink href={backHref} label={backLabel} className="btn-ghost btn-sm auth-back">
            <ArrowLeftIcon size={15} />
            {backLabel}
          </StageLink>
        ) : null}
        <div className="auth-poster-foot">
          <p className="annot">{owner}</p>
          <SplitReveal as="h1" className="auth-title" delay={0.25}>
            {title}
          </SplitReveal>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-form">{children}</div>
      </section>
    </div>
  );
}

/**
 * Ожидание до того, как известно, какой экран показывать.
 *
 * Без афиши и без анимации входа: следом почти всегда идёт афиша с формой, и
 * собранная дважды подряд она читалась бы как рывок. Подпись проявляется с
 * задержкой (`.auth-wait` в globals.css), поэтому быстрая проверка проходит
 * вовсе без неё.
 */
export function AuthWait({ children }: { children: ReactNode }) {
  return (
    <div className="auth-wait" role="status" aria-live="polite">
      <span>{children}</span>
    </div>
  );
}
