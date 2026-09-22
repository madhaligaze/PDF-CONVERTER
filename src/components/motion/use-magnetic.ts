"use client";

import { useRef } from "react";

import { canHover, gsap, prefersReducedMotion, useGSAP } from "./gsap";

/**
 * Элемент тянется за курсором и отпускает его пружиной.
 *
 * Только там, где есть настоящее наведение: на телефоне палец и так стоит
 * ровно на кнопке, а сдвиг после касания читался бы как промах.
 *
 * Сдвиг — `transform` через quickTo, без пересчёта раскладки. При снятии
 * компонента инлайновый transform убирается: оставленный, он делал бы элемент
 * контейнером для `position: fixed` потомков — та ловушка, что уже описана в
 * globals.css у `.bbc-enter`.
 */
export function useMagnetic<T extends HTMLElement>(strength = 0.3) {
  const ref = useRef<T>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el || !canHover() || prefersReducedMotion()) return;

      const xTo = gsap.quickTo(el, "x", { duration: 0.7, ease: "power3.out" });
      const yTo = gsap.quickTo(el, "y", { duration: 0.7, ease: "power3.out" });

      const move = (event: PointerEvent) => {
        const box = el.getBoundingClientRect();
        xTo((event.clientX - (box.left + box.width / 2)) * strength);
        yTo((event.clientY - (box.top + box.height / 2)) * strength);
      };
      const leave = () => {
        gsap.to(el, { x: 0, y: 0, duration: 1, ease: "elastic.out(1, 0.35)", overwrite: true });
      };

      el.addEventListener("pointermove", move);
      el.addEventListener("pointerleave", leave);
      return () => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerleave", leave);
        gsap.set(el, { clearProps: "transform" });
      };
    },
    { scope: ref },
  );

  return ref;
}
