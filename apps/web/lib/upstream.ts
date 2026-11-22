export function upstream(path: string) {
  const base = (
    process.env.API_URL ??
    `http://localhost:${process.env.API_PORT ?? 4000}/api`
  ).replace(/\/$/, "");
  return base + path;
}
