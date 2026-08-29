export function isAbsolute(value: string): boolean {
  return /^([A-Za-z]:)?[\\/]/.test(value) || value.startsWith("/");
}

export function resolve(...segments: string[]): string {
  return segments.filter(Boolean).join("/").replace(/\/+/g, "/");
}

export function join(...segments: string[]): string {
  return resolve(...segments);
}
