"use client";

import { useRef, useState } from "react";

import { FileTextIcon, UploadIcon } from "@/components/icons";
import { gsap, prefersReducedMotion, useGSAP } from "@/components/motion/gsap";
import { useWorkbench } from "@/components/workbench/context";
import type { ParserDescriptor } from "@/components/workbench/types";

const ACCEPTED = ".pdf,.xlsx,.xlsm,.png,.jpg,.jpeg";
const ACCEPTED_EXT = new Set([".pdf", ".xlsx", ".xlsm", ".png", ".jpg", ".jpeg"]);

function isValid(file: File) {
  return ACCEPTED_EXT.has(`.${(file.name.split(".").pop() ?? "").toLowerCase()}`);
}

function cleanLabel(label: string) {
  return label
    .replace(/\bStatement\b/gi, "")
    .replace(/\bScanned\b/gi, "Сканы")
    .replace(/\bGeneric Bank\b/gi, "Другие банки")
    .replace(/\bAdaptive Bank\b/gi, "Любая таблица")
    .replace(/\s{2,}/g, " ")
    .trim();
}

type Props = {
  file: File | null;
  parsers: ParserDescriptor[];
  onFileChange: (f: File | null) => void;
};

/** «5 форматов», «2 формата», «1 формат» — иначе счётчик читается как заглушка. */
function plural(count: number, one: string, few: string, many: string): string {
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = count % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

export function UploadPanel({ file, parsers, onFileChange }: Props) {
  const { isPending, handlePreviewNow } = useWorkbench();
  const [dragging, setDragging] = useState(false);
  const [showFormats, setShowFormats] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const zoneRef = useRef<HTMLDivElement>(null);

  const systemReady = parsers.length > 0;

  // Значок поднимается навстречу файлу, пока его несут над зоной, и опускается,
  // когда отпустили или унесли. Пружина на опускании — чтобы было видно, что
  // зона «приняла».
  useGSAP(
    () => {
      const icon = zoneRef.current?.querySelector(".drop-icon");
      if (!icon || prefersReducedMotion()) return;
      gsap.to(icon, dragging
        ? { y: -10, scale: 1.12, duration: 0.5, ease: "expo.out", overwrite: true }
        : { y: 0, scale: 1, duration: 0.9, ease: "elastic.out(1, 0.45)", overwrite: true });
    },
    { dependencies: [dragging], scope: zoneRef },
  );

  const state = dragging ? "over" : file ? "file" : "idle";

  return (
    <section className="card p-4 animate-fade-in">
      <input
        ref={inputRef}
        accept={ACCEPTED}
        className="hidden"
        type="file"
        onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
      />

      <div
        ref={zoneRef}
        role="button"
        tabIndex={0}
        aria-label="Загрузить файл"
        className="drop"
        data-state={state}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const dropped = e.dataTransfer.files[0];
          if (dropped && isValid(dropped)) onFileChange(dropped);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
      >
        {/* Рамка — штрих SVG, а не border-dashed: у рамки из штрихов CSS нельзя
            двигать сами штрихи, а у SVG можно, и пока файл несут над зоной,
            штрихи бегут по кругу. */}
        <svg className="drop-frame" aria-hidden="true">
          <rect x="0.5" y="0.5" width="100%" height="100%" rx="6" />
        </svg>
        {file ? (
          <div className="drop-file">
            <span className="drop-icon">
              <FileTextIcon size={22} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="drop-name">{file.name}</p>
              <p className="mono-meta">{(file.size / 1024).toFixed(0)} КБ · нажмите для замены</p>
            </div>
          </div>
        ) : (
          <div className="drop-empty">
            <span className="drop-icon">
              <UploadIcon size={24} />
            </span>
            {/* На телефоне перетаскивать нечего и некуда — там подпись о выборе. */}
            <p className="drop-title">
              {dragging ? (
                "Отпустите файл"
              ) : (
                <>
                  <span className="only-desktop-inline">Перетащите выписку или нажмите</span>
                  <span className="only-mobile">Выберите выписку</span>
                </>
              )}
            </p>
            <p className="mono-meta">PDF · Excel · изображения</p>
          </div>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <button
          className="btn-primary flex-1"
          disabled={!file || isPending}
          onClick={() => file && handlePreviewNow(file)}
          type="button"
        >
          {isPending ? (
            <span className="flex items-center justify-center gap-2">
              {/* Цвет от подписи кнопки: белый круг на кремовой кнопке пропадал. */}
              <span
                className="h-3.5 w-3.5 rounded-full border-2 animate-spin-slow flex-shrink-0"
                style={{
                  borderColor: "color-mix(in srgb, currentColor 28%, transparent)",
                  borderTopColor: "currentColor",
                }}
              />
              Обработка…
            </span>
          ) : "Анализировать"}
        </button>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        {/* Ни точки, ни фразы «система готова».

            Зелёный кружок, горящий всегда, — это шум, который перестают
            замечать ровно к тому моменту, когда он должен был напугать; та же
            беда и у надписи, которая при любом раскладе сообщает «всё
            хорошо». Вместо этого в порядке вещей стоит число форматов — оно
            и означает, что сервер ответил, и заодно говорит что-то новое,
            подхватывая соседнюю кнопку «Форматы».

            Цвет остаётся только на отказе. */}
        <div
          className="text-xs"
          style={{ color: systemReady ? "var(--text-muted)" : "var(--accent-rose)" }}
        >
          {systemReady
            ? `${parsers.length} ${plural(parsers.length, "формат", "формата", "форматов")}`
            : "Сервер недоступен"}
        </div>
        <button
          className="text-xs flex items-center gap-1 py-1.5 -my-1.5"
          style={{ color: "var(--text-muted)" }}
          onClick={() => setShowFormats((value) => !value)}
          type="button"
        >
          <span style={{
            display: "inline-block",
            transition: "transform 0.2s",
            transform: showFormats ? "rotate(90deg)" : "none",
          }}>›</span>
          Форматы
        </button>
      </div>

      {showFormats && (
        <div className="mt-2 card-inner p-3 animate-slide-up">
          <p className="text-[10px] uppercase tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>
            Поддерживаемые форматы
          </p>
          <ul className="space-y-1.5">
            {parsers.map((parser) => (
              <li key={parser.key} className="flex items-center gap-2 text-xs">
                <span className="flex gap-1 flex-shrink-0">
                  {parser.accepted_extensions.slice(0, 2).map((ext) => (
                    <span key={ext} className="badge badge-slate">{ext}</span>
                  ))}
                </span>
                <span className="truncate" style={{ color: "var(--text-secondary)" }}>
                  {cleanLabel(parser.label)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
