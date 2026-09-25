#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Send sample BBHitZone events to ingest (pipeline test without ModLoader)."""
from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

ENV = Path(__file__).with_name(".squad-collector.env")
for line in ENV.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, _, v = line.partition("=")
    os.environ.setdefault(k.strip(), v.strip().strip("'\""))

url = os.environ.get(
    "SQUAD_HITZONE_INGEST_URL",
    os.environ["SQUAD_INGEST_URL"].replace("squad-sessions", "squad-hitzones"),
)
secret = os.environ["SQUAD_INGEST_SECRET"]
# Keech steam from known profile — only counts if user exists in Neon
steam = os.environ.get("SQUAD_TEST_STEAM", "76561198028435874")
eos = os.environ.get("SQUAD_TEST_EOS", "00000000000000000000000000000001")
now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

events = [
    {
        "type": "hitzone",
        "at": now,
        "serverKey": "TR1",
        "zone": z,
        "attackerEosId": eos,
        "attackerSteamId": steam,
        "victimEosId": None,
        "damage": 50.0,
        "bone": bone,
        "weapon": "BP_Test_C",
    }
    for z, bone in (("Head", "head"), ("Torso", "spine_01"), ("Limb", "thigh_l"))
]

r = requests.post(
    url,
    headers={
        "Authorization": f"Bearer {secret}",
        "Content-Type": "application/json",
    },
    json={"events": events},
    timeout=30,
)
print(r.status_code, r.text)
sys.exit(0 if r.status_code < 300 else 1)
