import { spawn } from "child_process";
import path from "path";

export type PanelkaServer = {
  key: string;
  name: string;
  map: string;
  layer: string;
  players: number;
  maxPlayers: number;
  error: string | null;
};

export type PanelkaPlayer = {
  id: number;
  name: string;
  steamId: string;
  team: string;
};

const KEYS = new Set(["TR1", "TR2", "TR3", "TR4", "TR5"]);

function pythonBin(): string {
  return path.join(process.cwd(), "scripts", ".venv-collector", "bin", "python");
}

export function runPanelka(args: string[], timeoutMs = 35000): Promise<unknown> {
  const script = path.join(process.cwd(), "scripts", "panelka_rcon.py");
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin(), [script, ...args], {
      cwd: process.cwd(),
      env: process.env,
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("сервер не ответил вовремя"));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      out += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      err += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", () => {
      clearTimeout(timer);
      const text = out.trim();
      if (!text) {
        reject(new Error(err.trim() || "пустой ответ"));
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error(text.slice(0, 240)));
      }
    });
  });
}

export function isPanelkaKey(key: string): boolean {
  return KEYS.has(key);
}
