/** ArrowCode brand marks — no emoji, sharp monochrome ASCII. */

export const BANNER_FULL = `
     █████╗ ██████╗ ██████╗  ██████╗ ██╗    ██╗ ██████╗ ██████╗ ██████╗ ███████╗
    ██╔══██╗██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔═══██╗██╔══██╗██╔════╝
    ███████║██████╔╝██████╔╝██║   ██║██║ █╗ ██║██║     ██║   ██║██║  ██║█████╗  
    ██╔══██║██╔══██╗██╔══██╗██║   ██║██║███╗██║██║     ██║   ██║██║  ██║██╔══╝  
    ██║  ██║██║  ██║██║  ██║╚██████╔╝╚███╔███╔╝╚██████╗╚██████╔╝██████╔╝███████╗
    ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝  ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝
`.replace(/^\n/, "");

export const BANNER_COMPACT = `
    ▄▄▄       ██▀███   ██▀███   ▒█████   █     █░ ▄████▄   ▒█████  ▓█████▄ ▓█████
   ▒████▄    ▓██ ▒ ██▒▓██ ▒ ██▒▒██▒  ██▒▓█░ █ ░█░▒██▀ ▀█  ▒██▒  ██▒▒██▀ ██▌▓█   ▀
   ▒██  ▀█▄  ▓██ ░▄█ ▒▓██ ░▄█ ▒▒██░  ██▒▒█░ █ ░█ ▒▓█    ▄ ▒██░  ██▒░██   █▌▒███  
   ░██▄▄▄▄██ ▒██▀▀█▄  ▒██▀▀█▄  ▒██   ██░░█░ █ ░█ ▒▓▓▄ ▄██▒▒██   ██░░▓█▄   ▌▒▓█  ▄
    ▓█   ▓██▒░██▓ ▒██▒░██▓ ▒██▒░ ████▓▒░░░██▒██▓ ▒ ▓███▀ ░░ ████▓▒░░▒████▓ ░▒████▒
    ▒▒   ▓▒█░░ ▒▓ ░▒▓░░ ▒▓ ░▒▓░░ ▒░▒░▒░ ░ ▓░▒ ▒  ░ ░▒ ▒  ░░ ▒░▒░▒░  ▒▒▓  ▒ ░░ ▒░ ░
`.replace(/^\n/, "");

/** Clean line-art mark for small terminals / headers */
export const MARK = `
      /\\
     /  \\      ARROWCODE
    / /\\ \\     swarm coding harness
   / ______\\   
   \\/      \\/   plan · confirm · ship
`.replace(/^\n/, "");

export const MARK_INLINE = "ARROWCODE";

export const TAGLINE =
  "multi-agent swarm coding harness  ·  plan → confirm → ship";

export const RULE = "─".repeat(72);

export function printBanner(opts?: { compact?: boolean; width?: number }): void {
  const width = opts?.width ?? process.stdout.columns ?? 80;
  if (width < 88 || opts?.compact) {
    console.log(MARK);
  } else {
    console.log(BANNER_FULL);
  }
  console.log(`         ── ${TAGLINE} ──`);
  console.log("");
}

export function headerLine(version: string): string {
  return `ARROWCODE v${version}`;
}
