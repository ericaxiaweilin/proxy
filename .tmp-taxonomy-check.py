import json, glob, os, collections

D = 'apps/api-go/internal/tagging/taxonomy'
files = sorted(glob.glob(D + '/*.json'))
nodes = []
for f in files:
    data = json.load(open(f, encoding='utf-8'))
    for n in data['nodes']:
        n['_file'] = os.path.basename(f)
        nodes.append(n)

ids = [n['id'] for n in nodes]
idset = set(ids)
print('files:')
for f in files:
    own = [n for n in nodes if n['_file'] == os.path.basename(f)]
    print('  ', os.path.basename(f), 'nodes=', len(own))
print('total nodes', len(nodes))
print('dup ids', [k for k, v in collections.Counter(ids).items() if v > 1])
print('missing parents', [(n['id'], n.get('parent')) for n in nodes if n.get('parent') and n['parent'] not in idset])
print('bad child path', [n['id'] for n in nodes if n.get('parent') and not n['id'].startswith(n['parent'] + '/')])
print('too deep', [n['id'] for n in nodes if n['id'].count('/') > 3])


def id_ok(i):
    if not i or len(i) > 48:
        return False
    for seg in i.split('/'):
        if not seg:
            return False
        for c in seg:
            if not ('a' <= c <= 'z' or '0' <= c <= '9' or c == '_'):
                return False
    return True


print('bad ids', [n['id'] for n in nodes if not id_ok(n['id'])])
for n in nodes:
    for lang in ('zh', 'vi', 'en'):
        v = n['name'].get(lang, '')
        if not v.strip() or len(v) > 30:
            print('NAME ISSUE', n['id'], lang, repr(v), len(v))

kw = collections.Counter()
for n in nodes:
    c = len(n['keywords'])
    if not 3 <= c <= 10:
        print('KW COUNT', n['_file'], n['id'], c)
    for k in n['keywords']:
        kl = k.lower().strip()
        if kl != k:
            print('KW NORM', n['id'], repr(k))
        if len(kl) < 2 or len(kl) > 40:
            print('KW LEN', n['id'], repr(k))
    kw.update(k.lower().strip() for k in n['keywords'])

dups = {k for k, v in kw.items() if v > 1}
print('total keywords', sum(kw.values()), 'duplicate keywords', len(dups))
for k in sorted(dups):
    print('  DUP', repr(k), [n['id'] for n in nodes if k in [x.lower().strip() for x in n['keywords']]])

red = ['夜生活', '按摩', '桑拿', '陪酒', '陪睡', '包夜', '约炮', '色情', '成人', '招嫖', '卖淫', 'ktv', '夜店', '酒吧陪',
       '赌博', '博彩', '毒品', 'nightlife', 'massage', 'sauna', 'escort', 'prostitut', 'brothel', 'erotic', 'adult',
       'porn', 'gambl', 'casino', 'betting', 'drug', 'mát xa', 'gái gọi', 'mại dâm', 'cờ bạc', 'ma túy', 'sex']
for n in nodes:
    hay = ' '.join([n['id'], n['name']['zh'], n['name']['vi'], n['name']['en']] + n['keywords']).lower()
    for b in red:
        if b in hay:
            print('RED', n['id'], b)

# words that must not be generic (spec: no bare "fun/food/travel" style)
for n in nodes:
    for k in n['keywords']:
        if k in ('food', 'travel', 'fun', 'đẹp', '好玩', 'music', 'art', 'sport', 'sports', 'shopping',
                 'outdoor', 'photo', 'photography', 'festival', 'crafts', 'social', 'reading', 'learning',
                 '健康', 'sức khỏe', 'wellness', 'đồ uống', 'du lịch', 'travel tips', 'drinks', 'coffee shop'):
            print('GENERIC/ROOT COLLISION', n['id'], repr(k))
