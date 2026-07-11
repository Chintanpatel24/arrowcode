/** Clean monochrome-friendly palette — no emoji. */

export const theme = {
  brand: "cyan",
  border: "gray",
  borderActive: "cyan",
  borderError: "red",
  borderDone: "green",
  borderWait: "yellow",
  muted: "gray",
  text: "white",
  accent: "magenta",
  ok: "green",
  warn: "yellow",
  err: "red",
  tool: "yellow",
  headerBg: undefined as undefined,
} as const;

export function statusColor(status: string): string {
  switch (status) {
    case "thinking":
      return "cyan";
    case "tool":
      return "yellow";
    case "waiting":
      return "magenta";
    case "done":
      return "green";
    case "error":
    case "blocked":
      return "red";
    default:
      return "gray";
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case "idle":
      return "IDLE";
    case "thinking":
      return "THINK";
    case "tool":
      return "TOOL";
    case "waiting":
      return "WAIT";
    case "done":
      return "DONE";
    case "error":
      return "ERR";
    case "blocked":
      return "BLOCK";
    default:
      return status.toUpperCase();
  }
}
