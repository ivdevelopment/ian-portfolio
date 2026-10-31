/** Parses an amount a person typed or a spreadsheet held: "1500", "€ 1.500,50", "1,500.50", 1500. Null = blank/invalid. */
export function parseMoney(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? Math.round(raw * 100) / 100 : null;
  if (typeof raw !== "string") return null;
  let text = raw.replace(/[€\s]|eur/gi, "");
  if (!text) return null;
  if (!/^[\d.,]+$/.test(text)) return null;

  const lastDot = text.lastIndexOf(".");
  const lastComma = text.lastIndexOf(",");
  if (lastDot !== -1 && lastComma !== -1) {
    // The separator that comes last is the decimal mark; the other groups thousands.
    const decimal = lastDot > lastComma ? "." : ",";
    const group = decimal === "." ? "," : ".";
    text = text.split(group).join("").replace(decimal, ".");
  } else if (lastComma !== -1) {
    text = /^\d{1,3}(,\d{3})+$/.test(text) ? text.split(",").join("") : text.replace(",", ".");
  } else if (lastDot !== -1 && /^\d{1,3}(\.\d{3})+$/.test(text)) {
    text = text.split(".").join("");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export function formatEur(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  // Whole euros read cleanly (€ 1.500); cents only appear when the amount has them (€ 1.500,50).
  const digits = Number.isInteger(value) ? 0 : 2;
  return new Intl.NumberFormat("nl-BE", { style: "currency", currency: "EUR", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}
