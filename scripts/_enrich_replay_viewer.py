import json
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "data" / "replays" / "bb_20261018_003012_Narva_AAS_v1.json"
d = json.loads(p.read_text(encoding="utf-8"))
d["mapKey"] = "Narva"
d["title"] = "TR1 · Narva AAS v1"
d["recordedAt"] = "2026-10-18T00:30:43+03:00"
d["server"] = "TR1"
d["players"] = [x for x in d.get("players") or [] if x.get("name")]
p.write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
idx = {
    "version": 1,
    "matches": [
        {
            "id": d["id"],
            "title": d["title"],
            "layer": d["layer"],
            "mapKey": d["mapKey"],
            "duration_ms": d["duration_ms"],
            "server": d["server"],
            "recordedAt": d["recordedAt"],
            "tracks_players": len(d["tracks"]["players"]),
            "players": [t["key"] for t in d["tracks"]["players"]],
        }
    ],
}
(Path(__file__).resolve().parents[1] / "data" / "replays" / "index.json").write_text(
    json.dumps(idx, ensure_ascii=False, indent=2), encoding="utf-8"
)
print("ok", p.stat().st_size)
