export function formatValue(value: string | number | null | undefined, kind = "text") {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  if (kind === "currency" && typeof value === "number") {
    return new Intl.NumberFormat("ru-RU", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }

  return String(value);
}
