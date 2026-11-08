import { history } from "../../../fixtures";

// Only the KV HTML shell is tracked in this checkout, not its CSS/JS mirror.
// This fixture exercises same-origin iframe adaptation using its real table IDs
// and classes. It is not a replacement for testing the deployed KV application.
export function GET(req: Request) {
  const training = new URL(req.url).searchParams.get("kind") === "tm";
  const kind = training ? "tm" : "cw";
  const rows = history.map((m) => `<tr><td>${m.dateLabel}</td><td>${m.timeLabel}</td><td>${m.map}</td><td>BlackBerry</td><td>Demo Wolves</td><td>36 × 36</td><td>${m.kills}</td><td>${m.deaths}</td><td>${m.res}</td></tr>`).join("");
  return new Response(`<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local KV layout fixture</title><style>
    body{margin:0;background:#090711;color:#f2eefc;font:14px sans-serif;min-width:1440px}.wrap{width:1400px;margin:auto}h1{font-size:28px}.cw-head{display:flex;justify-content:space-between;align-items:center}.cw-tabs{display:flex;gap:8px}button,input{padding:10px;color:inherit;background:#20162e;border:1px solid #6d568c;border-radius:8px}table{width:1400px;border-collapse:collapse}td,th{text-align:left;padding:14px;border-bottom:1px solid #342440}p{color:#b7adc8}
    </style></head><body><main class="wrap"><section id="view-${kind}"><header class="cw-head"><h1>${training ? "Тренировочные матчи" : "Клановые войны"}</h1><nav class="cw-tabs"><button>Матчи</button><button>Рейтинг</button><button>Аналитика</button></nav></header><p>Тестовый документ для проверки встраивания. Данные вымышлены.</p><table><thead><tr>${["Дата", "Время", "Карта", "Клан", "Соперник", "Формат", "Киллы", "Смерти", "Ресы"].map((s) => `<th>${s}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></section></main></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
