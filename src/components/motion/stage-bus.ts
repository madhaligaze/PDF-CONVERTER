"use client";

/**
 * Закрыт ли экран занавесом перехода.
 *
 * Страница, в которую ведёт переход, монтируется, пока занавес ещё опущен, и
 * её собственный вход отыграл бы целиком за занавесом — человек увидел бы уже
 * собранный экран, а вход, ради которого всё затевалось, пропал бы. Поэтому
 * входы ждут здесь: пока занавес опущен, обещание висит; поднялся — выполнено.
 *
 * Состояние модульное, а не в контексте React: входы живут в компонентах,
 * которые не обязаны лежать внутри провайдера (стартовый экран, экраны входа),
 * и тянуть к каждому контекст ради одного флага незачем.
 */
let clear: Promise<void> = Promise.resolve();
let release: (() => void) | null = null;

export function markStageCovered(): void {
  if (release) return;
  clear = new Promise<void>((resolve) => {
    release = resolve;
  });
}

export function markStageClear(): void {
  release?.();
  release = null;
}

export function whenStageClear(): Promise<void> {
  return clear;
}
