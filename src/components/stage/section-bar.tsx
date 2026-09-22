"use client";

import type { ReactNode } from "react";

import { ArrowLeftIcon } from "@/components/icons";
import { StageLink } from "@/components/motion/stage-transition";

/**
 * Верхняя строка раздела: выход на уровень выше и место под действия справа.
 *
 * Выход — через занавес, подпись на занавесе совпадает с подписью кнопки:
 * человек видит, куда уходит, пока уходит.
 */
export function SectionBar({
  backHref = "/",
  backLabel = "Разделы",
  children,
}: {
  backHref?: string;
  backLabel?: string;
  children?: ReactNode;
}) {
  return (
    <header className="section-bar">
      <StageLink href={backHref} label={backLabel} className="btn-ghost btn-sm" title={backLabel}>
        <ArrowLeftIcon size={15} />
        <span className="only-desktop-inline">{backLabel}</span>
      </StageLink>
      <div className="section-bar-right">{children}</div>
    </header>
  );
}
