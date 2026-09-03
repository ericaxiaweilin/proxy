#!/bin/bash
set -e
BASE="http://127.0.0.1:4100"

echo "1) GET /v1/legal/terms (expect 200, body >= 1000 bytes)"
status=$(curl -s -o /tmp/terms.json -w "%{http_code}" "$BASE/v1/legal/terms")
[ "$status" = "200" ] || { echo "FAIL: status=$status"; exit 1; }
bytes=$(wc -c < /tmp/terms.json | tr -d ' ')
[ "$bytes" -ge 1000 ] || { echo "FAIL: bytes=$bytes"; exit 1; }
echo "  OK: status=200 body=$bytes bytes"

echo "2) GET /v1/legal/privacy (expect 200, body >= 1000 bytes)"
status=$(curl -s -o /tmp/privacy.json -w "%{http_code}" "$BASE/v1/legal/privacy")
[ "$status" = "200" ] || { echo "FAIL: status=$status"; exit 1; }
bytes=$(wc -c < /tmp/privacy.json | tr -d ' ')
[ "$bytes" -ge 1000 ] || { echo "FAIL: bytes=$bytes"; exit 1; }
echo "  OK: status=200 body=$bytes bytes"

echo "3) GET /v1/legal/cookie-policy (expect 404)"
status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/v1/legal/cookie-policy")
[ "$status" = "404" ] || { echo "FAIL: status=$status"; exit 1; }
echo "  OK: status=404"

echo "4) Content-Type must be application/json"
ctype=$(curl -s -I "$BASE/v1/legal/terms" | grep -i "content-type" | tr -d '\r\n')
echo "  $ctype"
[[ "$ctype" == *"application/json"* ]] || { echo "FAIL: wrong content-type"; exit 1; }
echo "  OK"

echo "5) Cache-Control: public, max-age=300"
cc=$(curl -s -I "$BASE/v1/legal/terms" | grep -i "cache-control" | tr -d '\r\n')
echo "  $cc"
[[ "$cc" == *"max-age=300"* ]] || { echo "FAIL: wrong cache-control"; exit 1; }
echo "  OK"

echo "6) Parse JSON envelope"
python3 -c "
import json
d = json.load(open('/tmp/terms.json'))
assert d['kind'] == 'terms', f'kind={d[\"kind\"]}'
assert d['version'] == '1.1', f'version={d[\"version\"]}'
assert d['locale'] == 'vi-VN', f'locale={d[\"locale\"]}'
assert '服务使用协议' in d['title'], f'title={d[\"title\"]}'
assert len(d['content']) > 5000, f'content length={len(d[\"content\"])}'
assert len(d['contentSha256']) == 64, f'sha256={d[\"contentSha256\"]}'
print(f'  OK: kind={d[\"kind\"]} version={d[\"version\"]} content={len(d[\"content\"])} chars')
"

echo "ALL PASS"
