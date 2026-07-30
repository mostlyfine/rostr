export const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

export const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;
