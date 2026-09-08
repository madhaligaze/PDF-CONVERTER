"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * Высота элемента — от его верха до низа окна, за вычетом того, что стоит ниже.
 *
 * Зачем измерять, если высоту можно задать в `vh`
 * ───────────────────────────────────────────────
 * Долей окна высоту таблицы задать нельзя, потому что над ней стоит не
 * постоянная величина. На широком экране это две строки панелей; на телефоне
 * они переносятся в четыре, а сверху ещё может встать полоса о том, что лист
 * не читается. `68vh` в этот момент означает «таблица длиннее, чем осталось
 * места», и появляется вторая прокрутка: человек тянет таблицу, а едет
 * страница. На 390 пикселях это и вышло — 1084 пикселя содержимого при окне
 * 844.
 *
 * Почему «что стоит ниже» считается по-честному, а не как остаток окна
 * ────────────────────────────────────────────────────────────────────
 * Первая попытка брала остаток: `scrollHeight` документа минус низ элемента.
 * На странице это дало неподвижную точку. Оболочка дашборда пришпилена к
 * высоте окна (`min-h-screen`), поэтому высота документа всегда равна окну:
 * какой бы ни была высота элемента, «остаток» её ровно дополнял, и расчёт
 * возвращал ту же величину, что была. Список карточек так и застрял на своём
 * минимуме — четверть экрана, а под ним пустота во весь экран.
 *
 * Поэтому ниже считается то, что там действительно стоит: соседи после
 * элемента на каждом уровне вложенности и нижние отступы их родителей — вплоть
 * до предка, чей низ уже у края окна. От высоты самого элемента эта величина
 * не зависит, поэтому расчёт сходится с первого раза.
 */
export function useFillHeight(min = 240, gap = 0) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(min);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;

    /** Предок, ниже которого места уже нет: его низ стоит у нижнего края окна. */
    const anchorOf = (from: HTMLElement) => {
      for (let up = from.parentElement; up; up = up.parentElement) {
        if (up.getBoundingClientRect().bottom >= window.innerHeight - 1) return up;
      }
      return document.documentElement;
    };

    /** Сумма всего, что стоит ниже элемента внутри его предков. */
    const tailOf = (from: HTMLElement) => {
      const anchor = anchorOf(from);
      let tail = 0;
      for (let step: HTMLElement | null = from; step && step !== anchor; ) {
        const parent: HTMLElement | null = step.parentElement;
        if (!parent) break;
        const style = getComputedStyle(parent);
        const rowGap = parseFloat(style.rowGap) || 0;
        tail += parseFloat(style.paddingBottom) || 0;
        for (let next = step.nextElementSibling; next; next = next.nextElementSibling) {
          tail += next.getBoundingClientRect().height + rowGap;
        }
        step = parent;
      }
      return tail;
    };

    const measure = () => {
      const top = node.getBoundingClientRect().top;
      setHeight(Math.max(min, Math.round(window.innerHeight - top - tailOf(node) - gap)));
    };

    measure();
    // И ещё раз следующим кадром.
    //
    // В тот кадр, когда элемент монтируется, раскладка над ним не обязана быть
    // окончательной: раздел меняет заглушку на таблицу, панели переносятся,
    // шрифты досчитываются. Замер в этот момент даёт положение, которого через
    // мгновение уже нет. Так и вышло с листом Univer: расчёт возвращал 320
    // пикселей вместо 683, таблица занимала треть экрана, а под ней стояла
    // пустота — и по одному замеру понять это было нельзя, потому что число
    // выглядело как настоящее.
    const again = requestAnimationFrame(measure);

    // Наблюдаем и за `body`, и за родителем: меняется то, что стоит НАД
    // элементом и ПОД ним — панели, полоса об ошибке чтения листа. Родитель
    // нужен отдельно, потому что высота `body` в этой оболочке приколочена
    // к окну (`min-h-screen`) и не меняется никогда.
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    if (node.parentElement) observer.observe(node.parentElement);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(again);
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [min, gap]);

  return { ref, height };
}
