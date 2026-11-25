#!/bin/bash
# Apply F-01…F-05 nginx pieces. Idempotent.
# Rollback: remove include lines + snippet; comment server_tokens; nginx -t && reload.
set -euo pipefail
ROOT="${ROOT:-/var/www/bb-squad-platform}"
SITE="/etc/nginx/sites-available/bb-squad"
SNIP_SRC="$ROOT/deploy/nginx-bb-security-headers.conf"
SNIP_DST="/etc/nginx/snippets/bb-security-headers.conf"
INCLUDE='include /etc/nginx/snippets/bb-security-headers.conf;'

if [[ ! -f "$SNIP_SRC" ]]; then
  echo "missing $SNIP_SRC" >&2
  exit 1
fi
if [[ ! -f "$SITE" ]]; then
  echo "missing $SITE" >&2
  exit 1
fi

mkdir -p /etc/nginx/snippets
cp -f "$SNIP_SRC" "$SNIP_DST"
chmod 644 "$SNIP_DST"

# F-05: hide nginx version
if grep -qE '^\s*#\s*server_tokens\s+off;' /etc/nginx/nginx.conf; then
  sed -i 's/^\(\s*\)#\s*server_tokens\s\+off;/\1server_tokens off;/' /etc/nginx/nginx.conf
elif ! grep -qE '^\s*server_tokens\s+off;' /etc/nginx/nginx.conf; then
  sed -i '/^http\s*{/a\	server_tokens off;' /etc/nginx/nginx.conf
fi

cp -a "$SITE" "${SITE}.bak-security-$(date +%Y%m%d%H%M%S)"

python3 - <<'PY'
from pathlib import Path
import re

path = Path("/etc/nginx/sites-available/bb-squad")
text = path.read_text(encoding="utf-8")
include = "include /etc/nginx/snippets/bb-security-headers.conf;"

# 1) Server-level include after ssl_dhparam (HTTPS)
needle = "ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;"
server_block = (
    needle
    + "\n\n    # BEGIN bb-security-headers\n"
    + "    " + include + "\n"
    + "    # END bb-security-headers"
)
if include not in text.split("listen 443", 1)[-1][:800] if "listen 443" in text else True:
    pass
if "BEGIN bb-security-headers" not in text:
    if needle not in text:
        raise SystemExit("ssl_dhparam marker not found")
    text = text.replace(needle, server_block, 1)
    print("injected server-level include")
else:
    print("server-level include already present")

# 2) Per-location: if location has add_header but no security include, add after "{"
lines = text.splitlines(True)
out = []
i = 0
changed = 0
while i < len(lines):
    line = lines[i]
    m = re.match(r"^(\s*)location\b.*\{\s*$", line)
    if not m:
        out.append(line)
        i += 1
        continue
    indent = m.group(1) + "    "
    # collect until matching closing brace at same indent level (simple depth)
    block = [line]
    i += 1
    depth = 1
    while i < len(lines) and depth > 0:
        l = lines[i]
        depth += l.count("{") - l.count("}")
        block.append(l)
        i += 1
    body = "".join(block)
    if "add_header" in body and include not in body:
        # insert include after opening location line
        block.insert(1, f"{indent}{include}\n")
        changed += 1
    out.extend(block)

path.write_text("".join(out), encoding="utf-8")
print(f"location includes ensured, newly_added={changed}")
PY

nginx -t
systemctl reload nginx
echo "OK nginx security headers applied"
