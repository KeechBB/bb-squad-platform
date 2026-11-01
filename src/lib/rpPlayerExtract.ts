/**
 * One player from an RP ledger, without JSON.parse of the whole file.
 * Public ledger is 600MB+; a full parse blows the Node worker and the
 * profile says there is no RP for the nick.
 */
import { createReadStream } from "node:fs";
import type { RpPlayer } from "@/lib/trainRp";

export async function extractRpPlayerAt(
  filePath: string,
  nickKey: string
): Promise<RpPlayer | null> {
  const want = String(nickKey || "").trim().toLowerCase();
  if (!want || !filePath) return null;
  const playersMark = Buffer.from('"players"');
  const needle = Buffer.from(`"${want}":`);

  return new Promise((resolve) => {
    let settled = false;
    const stream = createReadStream(filePath, { highWaterMark: 4 * 1024 * 1024 });
    const finish = (value: RpPlayer | null) => {
      if (settled) return;
      settled = true;
      stream.destroy();
      resolve(value);
    };

    let carry = Buffer.alloc(0);
    let inPlayers = false;
    let capturing = false;
    const parts: Buffer[] = [];
    let partBytes = 0;
    let depth = 0;
    let inStr = false;
    let esc = false;

    stream.on("error", () => finish(null));
    stream.on("end", () => finish(null));
    stream.on("data", (chunk: Buffer | string) => {
      if (settled) return;
      const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const buf = carry.length ? Buffer.concat([carry, piece]) : piece;
      let i = 0;

      if (!inPlayers) {
        const at = buf.indexOf(playersMark);
        if (at < 0) {
          carry =
            buf.length > playersMark.length
              ? buf.subarray(buf.length - playersMark.length)
              : Buffer.from(buf);
          return;
        }
        inPlayers = true;
        i = at + playersMark.length;
      }

      while (!capturing) {
        const at = buf.indexOf(needle, i);
        if (at < 0) {
          carry =
            buf.length > needle.length
              ? buf.subarray(buf.length - needle.length)
              : Buffer.from(buf);
          return;
        }
        let j = at + needle.length;
        while (
          j < buf.length &&
          (buf[j] === 0x20 || buf[j] === 0x0a || buf[j] === 0x0d || buf[j] === 0x09)
        ) {
          j += 1;
        }
        if (j >= buf.length) {
          carry = buf.subarray(at);
          return;
        }
        if (buf[j] !== 0x7b) {
          i = j;
          continue;
        }
        capturing = true;
        depth = 0;
        inStr = false;
        esc = false;
        parts.length = 0;
        partBytes = 0;
        i = j;
        break;
      }
      if (!capturing) return;

      const start = i;
      for (; i < buf.length; i += 1) {
        const c = buf[i]!;
        if (inStr) {
          if (esc) esc = false;
          else if (c === 0x5c) esc = true;
          else if (c === 0x22) inStr = false;
          continue;
        }
        if (c === 0x22) {
          inStr = true;
          continue;
        }
        if (c === 0x7b) depth += 1;
        else if (c === 0x7d) {
          depth -= 1;
          if (depth === 0) {
            parts.push(buf.subarray(start, i + 1));
            try {
              finish(JSON.parse(Buffer.concat(parts).toString("utf8")) as RpPlayer);
            } catch {
              finish(null);
            }
            return;
          }
        }
      }
      parts.push(buf.subarray(start));
      partBytes += buf.length - start;
      if (partBytes > 32 * 1024 * 1024) finish(null);
      carry = Buffer.alloc(0);
    });
  });
}
