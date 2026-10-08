import json, glob, re

RED = ["夜生活", "按摩", "桑拿", "陪酒", "陪睡", "包夜", "约炮", "色情", "成人", "招嫖", "卖淫",
       "ktv", "夜店", "酒吧陪", "赌博", "博彩", "毒品", "nightlife", "massage", "sauna", "escort",
       "prostitut", "brothel", "erotic", "adult", "porn", "gambl", "casino", "betting", "drug",
       "mát xa", "gái gọi", "mại dâm", "cờ bạc", "ma túy", "sex"]
ID_MAX = 48
KW_MIN = 2
KW_MAX = 40
NAME_MAX = 30
DEPTH_MAX = 3

ids, kwmap, errs, per = {}, {}, [], {}
for f in sorted(glob.glob("*.json")):
    doc = json.load(open(f))
    per[f] = len(doc["nodes"])
    if doc["domain"] != "interest":
        errs.append(f + " bad domain")
    for n in doc["nodes"]:
        i, nm = n["id"], n["name"]
        if i in ids:
            errs.append("dup id " + i)
        ids[i] = n
        if len(i) > ID_MAX:
            errs.append("id too long " + i)
        for seg in i.split("/"):
            if not re.fullmatch(r"[a-z0-9_]+", seg):
                errs.append("bad id seg " + i)
        if i.count("/") > DEPTH_MAX:
            errs.append("too deep " + i)
        p = n.get("parent")
        if p and not i.startswith(p + "/"):
            errs.append("not child path " + i)
        for lang in ("zh", "vi", "en"):
            v = nm.get(lang, "")
            if not v.strip():
                errs.append(i + " empty " + lang)
            if len(v) > NAME_MAX:
                errs.append(i + " name " + lang + " length " + str(len(v)) + " " + v)
        kws = n.get("keywords", [])
        if len(kws) < 3 or len(kws) > 10:
            errs.append(i + " keyword count " + str(len(kws)))
        low = [k.lower().strip() for k in kws]
        if len(set(low)) != len(low):
            errs.append(i + " duplicate keyword inside node")
        for k in low:
            if len(k) < KW_MIN or len(k) > KW_MAX:
                errs.append(i + " keyword length " + k)
            if k in kwmap and kwmap[k] != i:
                errs.append(i + " keyword " + k + " already owned by " + kwmap[k])
            if k not in kwmap:
                kwmap[k] = i
        hay = (i + " " + nm.get("zh", "") + " " + nm.get("vi", "") + " " + nm.get("en", "")
               + " " + " ".join(low)).lower()
        for b in RED:
            if b in hay:
                errs.append(i + " REDLINE " + b)

for i, n in ids.items():
    p = n.get("parent")
    if p and p not in ids:
        errs.append(i + " unknown parent " + p)

print("node counts", per)
print("distinct keywords", len(kwmap))
print("errors", len(errs))
for e in errs:
    print("  -", e)
