#!/usr/bin/env bash
# DESIGN-CONTRACT-REFS-001（2026-09-30）：IMPLEMENTATION_CONTRACTS.json 里每个合同的
# implementationFiles / reference 必须指向**真实存在**的文件，status 必须是合法枚举。
#
# 为什么需要：design-baseline 里有一段「文件被 git rm 掉就跳过敏感检查」的豁免逻辑
# （删基线敏感实现文件时不该因为文件不存在而报一条没意义的错）。但同一个豁免也意味着
# —— 文件被改名/移走后，合同的实现文件列表会**静默失效**：不报错、不提醒，于是那份
# 合同实际上不再声明任何实现，而 IMPLEMENTATION_CONTRACTS 还写着「PARTIAL」/
# 「IMPLEMENTED」，看起来一切正常。
#
# 顺带把状态枚举钉住：status 同样是「拼错一个字母就等于关掉这条检查」的枚举。
#
# 为什么是独立脚本（2026-10-02）：这段原来内联在 check-regression-contracts.sh 里，
# 于是它自己坏掉时没有任何东西能把它单独跑红。现在它是可执行单元，`--selftest` 用
# 变异输入证明它真的会红 —— 见文件末尾，那正是 BASH-IFS-TAB-COLLAPSE-001 的命名测试。
#
# 纯数据判断（status 枚举、implementationFiles 的形状）交给 jq，文件存在性交给 bash。
# 两处都必须显式接住 jq 的退出码：`contract_bad=$(jq …)` 在 jq 报错时得到**空串**，
# 而空串正是「一切正常」的取值 —— 于是结构一合不上（例如 implementationFiles 写成
# 字符串，`[]` 迭代直接报错）门禁就从判红翻成常绿。检查读不了输入时必须红。
#
# 从 repo 根目录调用（和 check-regression-contracts.sh 一致）：合同里的路径是仓库相对
# 路径，存在性判断依赖 cwd。CONTRACTS_JSON 只给 --selftest 覆盖，用坏输入证明门禁会红。
set -euo pipefail

CONTRACTS_JSON="${CONTRACTS_JSON:-docs/design/IMPLEMENTATION_CONTRACTS.json}"

# ---------------------------------------------------------------------------
# BASH-IFS-TAB-COLLAPSE-001 —— 命名测试（`--selftest`）
#
# 2026-10-02 我修这个门禁时，把 `node -e` 换成 jq + bash 存在性循环，看起来一切正常：
# 干净输入绿。但拿「implementationFiles 里加一个不存在的路径」去变异它，它**还是绿**
# —— 因为存在性循环从头到尾没执行过一次（原因见下面的注释块）。一段能读输入、能跑完、
# 却对破坏毫无反应的门禁，比没有门禁更糟：它提供假的安全感。
#
# 所以这段用真变异输入证明每一条破坏都会变红。绿不算证据，红了才算。
# 用法（repo 根目录）：bash scripts/check-design-contract-refs.sh --selftest
# ---------------------------------------------------------------------------
if [ "${1:-}" = "--selftest" ]; then
  SELFReal="docs/design/IMPLEMENTATION_CONTRACTS.json"
  if [ ! -f "$SELFReal" ]; then
    echo "SELFTEST ABORT: 不在 repo 根目录（找不到 ${SELFReal}）—— 变异测试无法判定。" >&2
    exit 1
  fi
  selftmp=$(mktemp -d)
  trap 'rm -rf "$selftmp"' EXIT
  self_pass=0
  self_fail=0
  # $1 标签  $2 jq 程序  $3 期望退出码（0=绿，1=红）
  self_case() {
    jq "$2" "$SELFReal" > "$selftmp/mut.json" || { echo "  SKIP(构造失败) $1"; return; }
    set +e
    CONTRACTS_JSON="$selftmp/mut.json" bash "$0" >/dev/null 2>&1
    local rc=$?
    set -e
    if [ "$rc" -eq "$3" ]; then
      self_pass=$((self_pass + 1))
      printf '  OK   want=%s got=%s  %s\n' "$3" "$rc" "$1"
    else
      self_fail=$((self_fail + 1))
      printf '  BAD  want=%s got=%s  %s  <-- 这种破坏不会被门禁发现\n' "$3" "$rc" "$1"
    fi
  }
  echo "  check-design-contract-refs --selftest（变异测试：每条破坏都必须红）"
  self_case "control: 真实合同"                 '.' 0
  self_case "status 拼错"                       '.contracts[0].status = "PARTIALX"' 1
  self_case "status 缺失"                       'del(.contracts[0].status)' 1
  self_case "status = null"                     '.contracts[0].status = null' 1
  self_case "实现文件指向不存在的路径"          '.contracts[0].implementationFiles += ["no/such/file.go"]' 1
  self_case "reference 指向不存在的路径"        '.contracts[0].reference = "docs/design/nope.html"' 1
  self_case "implementationFiles = []"          '.contracts[0].implementationFiles = []' 1
  self_case "implementationFiles 不是数组"      '.contracts[0].implementationFiles = "oops"' 1
  self_case "implementationFiles 含空串"        '.contracts[0].implementationFiles += [""]' 1
  self_case "implementationFiles 含 null"       '.contracts[0].implementationFiles += [null]' 1
  self_case "contracts 键被删"                  'del(.contracts)' 1
  self_case "contracts = []"                    '.contracts = []' 1
  self_case "contracts 不是数组"                '.contracts = {}' 1
  self_case "所有 implementationFiles 清空"     '(.contracts[].implementationFiles) = []' 1
  printf '{"contracts": [' > "$selftmp/broken.json"
  set +e
  CONTRACTS_JSON="$selftmp/broken.json" bash "$0" >/dev/null 2>&1
  rc=$?
  set -e
  if [ "$rc" -eq 1 ]; then
    self_pass=$((self_pass + 1)); echo "  OK   want=1 got=1  JSON 坏了（截断）"
  else
    self_fail=$((self_fail + 1)); echo "  BAD  want=1 got=$rc  JSON 坏了（截断）"
  fi
  echo "  selftest: pass=${self_pass} fail=${self_fail}"
  if [ "$self_fail" -ne 0 ]; then
    echo "  FAIL [BASH-IFS-TAB-COLLAPSE-001]: 门禁对已知破坏无反应 —— 它是空守卫，不许并入。" >&2
    exit 1
  fi
  echo "    BASH-IFS-TAB-COLLAPSE-001: PASS (${self_pass} 条变异逐条确认会变红)"
  exit 0
fi

fail() { echo "  FAIL [DESIGN-CONTRACT-REFS-001]: $*" >&2; return 1; }

if ! jq empty "$CONTRACTS_JSON" >/dev/null 2>&1; then
  fail "读不了 ${CONTRACTS_JSON} —— 合同检查无法判定。"
  exit 1
fi

# 「没有任何合同」和「所有合同都干净」必须能分开：`( .contracts // [] )` 在键名写错、
# 文件被换成 `{}` 时都产出空列表，于是下面两段 jq 都不输出任何违规 —— 门禁永远绿。
# 无输入的门禁就是空守卫，判红。
_contract_n=$(jq -r '(.contracts // []) | length' "$CONTRACTS_JSON")
if ! printf '%s' "$_contract_n" | grep -qE '^[1-9][0-9]*$'; then
  fail "IMPLEMENTATION_CONTRACTS 里没有可检查的合同（contracts 缺失、非数组或长度为 ${_contract_n}）—— 没有输入的检查必然常绿。"
  exit 1
fi

contract_bad=$(jq -r '
  ["IMPLEMENTED","PARTIAL","SCAFFOLD_ONLY"] as $valid
  | [ (.contracts // [])[]
      | . as $c
      | (if ($c | has("implementationFiles")) then $c.implementationFiles else [] end) as $impl
      # 「没写 status」和「status 填成 null」要分得开：undefined ≠ null，
      # 混成一种写法，读日志的人就不知道是漏字段还是填错。
      | (if ($c | has("status")) then $c.status else false end) as $probe
      | (if ($c | has("status")) then ($c.status | tostring) else "undefined" end) as $shown
      | (if ($valid | index($probe)) == null
         then "非法 status \"\($shown)\" (scope=\($c.scope))" else empty end),
        (if ($impl | type) != "array"
         then "\($c.scope) 的 implementationFiles 不是数组（是 \($impl | type)）" else empty end),
        (if ($impl | type) == "array" and ($impl | length) == 0
         then "\($c.scope) 没有 implementationFiles（等于没声明实现）" else empty end),
        # 空串 / 非字符串条目立刻判红：它们在下面那段 TSV 里会变成一个**空字段**，
        # 而空字段在 bash 里根本传不过来 —— 见 BASH-IFS-TAB-COLLAPSE-001。
        (if ($impl | type) == "array"
         then ($impl[] | select((type != "string") or (length == 0))
               | "\($c.scope) 的 implementationFiles 有条目不是非空字符串：\(. | tostring)")
         else empty end)
    ]
  | join("; ")
' "$CONTRACTS_JSON")

# 声明了路径就得真的存在。
#
# BASH-IFS-TAB-COLLAPSE-001（2026-10-02，这段自己逃过一次）：字段顺序是
# path、scope、kind，**三个都必须非空**。这里踩过一次真坑 —— 原来输出的是
# `scope \t "" \t path`，用一个空字段占位区分 impl / reference。但 tab 属于 POSIX
# 的 IFS **空白**字符，bash 的 `read` 会把连续空白**并成一个分隔符**、并丢掉首尾空白：
#   printf 'a\t\tb' | { IFS=$'\t' read x y z; }   →  x=a y=b z=空
# 而不是 x=a y=空 z=b。于是 `_cpath` 恒为空、`[ -n … ] || continue` 恒成立，**整个
# 存在性检查一段死代码都不剩**，而 12 个合同全绿 —— 用「指向不存在文件」去变异它都
# 不变红。改成非空 kind 列；并且用 `<<<` 而不是 `done < <(jq …)`，进程替换里 jq 的
# 失败码没人收（`while` 循环本身总是 0），失败就会静默成「零条路径」。
contract_rows=$(jq -r '
  (.contracts // [])[] | . as $c
  | (if ($c | has("implementationFiles")) then $c.implementationFiles else [] end) as $impl
  | (if ($impl | type) == "array"
     then ($impl[] | select(type == "string" and length > 0)
           | [., ($c.scope | tostring), "implementationFiles"] | @tsv)
     else empty end),
    (if (($c.reference | type) == "string" and ($c.reference | length) > 0)
     then [$c.reference, ($c.scope | tostring), "reference"] | @tsv
     else empty end)
' "$CONTRACTS_JSON")

_contract_checked=0
while IFS=$'\t' read -r _cpath _cscope _ckind; do
  [ -n "$_cpath" ] || continue
  _contract_checked=$((_contract_checked + 1))
  # 字段必须齐全：kind 为空说明上游又产出了空字段 —— 立刻红，不要退化成静默跳过。
  if [ -z "$_ckind" ]; then
    contract_bad="${contract_bad:+$contract_bad; }${_cscope} 的路径行字段不全（kind 缺失）：${_cpath}"
  fi
  if [ ! -e "$_cpath" ]; then
    contract_bad="${contract_bad:+$contract_bad; }${_cscope} 的 ${_ckind} 指向不存在的文件：${_cpath}"
  fi
done <<< "$contract_rows"

# 有合同却没产生任何一行待检查路径 = 上面那个空字段 bug 的复发形态，不能算通过。
if [ "$_contract_checked" -eq 0 ]; then
  fail "${_contract_n} 个合同却一条待检查路径都没解析出来 —— 字段切分或合同形状坏了，判红。"
  exit 1
fi

if [ -n "$contract_bad" ]; then
  echo "  FAIL [DESIGN-CONTRACT-REFS-001]: IMPLEMENTATION_CONTRACTS 声明与仓库实况不符：" >&2
  echo "        ${contract_bad}" >&2
  echo "        四种成因：" >&2
  echo "        · status 不在 {IMPLEMENTED, PARTIAL, SCAFFOLD_ONLY} —— 拼错即等于关掉这条检查" >&2
  echo "        · implementationFiles / reference 指向的文件不存在 —— 文件改名后合同会静默失效" >&2
  echo "          （design-baseline 的 deleted 豁免让缺文件不报错）" >&2
  echo "        · implementationFiles 为空 —— 等于这份合同没有声明任何实现" >&2
  echo "        · implementationFiles 条目不是非空字符串 —— 空字段会被 bash 的 IFS 空白规则吞掉" >&2
  exit 1
fi

echo "    DESIGN-CONTRACT-REFS-001: PASS (${_contract_n} 个合同 · ${_contract_checked} 条声明路径逐个确认存在 · status 枚举合法)"
