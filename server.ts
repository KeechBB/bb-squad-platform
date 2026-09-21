/**
 * Custom Node server: Next.js + WebSocket для «Карт-дуэль».
 * Остальной сайт — обычный HTTP через Next.
 */
import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { attachRaceWebSocket } from "./src/lib/raceWsHub";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = Number(process.env.PORT || 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    const server = createServer((req, res) => {
      try {
        const parsedUrl = parse(req.url || "/", true);
        handle(req, res, parsedUrl);
      } catch (err) {
        console.error("HTTP handler error", err);
        res.statusCode = 500;
        res.end("internal error");
      }
    });

    attachRaceWebSocket(server);

    server.listen(port, hostname, () => {
      console.log(`> bb-squad ready on http://${hostname}:${port} (ws /api/reaction/race/ws)`);
    });
  })
  .catch((err) => {
    console.error("Failed to start server", err);
    process.exit(1);
  });
