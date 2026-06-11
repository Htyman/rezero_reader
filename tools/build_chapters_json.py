#!/usr/bin/env python3
"""
Сканирует .md-файлы в папках volume-*/chapters и пересобирает chapters.json.
Запускать из корня проекта: python tools/build_chapters_json.py content/arc-6
Для новой арки: python tools/build_chapters_json.py content/arc-5
"""
from pathlib import Path
import json, re, sys

FM = re.compile(r'^---\s*\n(.*?)\n---\s*\n?', re.S)

def parse_frontmatter(text):
    meta = {}; body = text
    m = FM.match(text)
    if m:
        body = text[m.end():]
        for line in m.group(1).splitlines():
            if ':' not in line or line.strip().startswith('#'): continue
            k, v = line.split(':', 1)
            v = v.strip().strip('"').strip("'")
            if re.fullmatch(r'\d+', v): v = int(v)
            meta[k.strip()] = v
    return meta, body

def slugify(s):
    s = str(s).lower().replace('ё','е')
    s = re.sub(r'[^a-zа-я0-9]+','-',s)
    return re.sub(r'-+','-',s).strip('-') or 'chapter'

def plain(md):
    md = FM.sub('', md)
    md = re.sub(r'!\[[^\]]*\]\([^\)]*\)', ' ', md)
    md = re.sub(r'[#>*_`\[\]\(\)]', ' ', md)
    return re.sub(r'\s+', ' ', md).strip()

arc_dir = Path(sys.argv[1] if len(sys.argv) > 1 else 'content/arc-6')
if not arc_dir.exists():
    raise SystemExit(f'Нет папки: {arc_dir}')

for vdir in sorted(arc_dir.glob('volume-*')):
    cdir = vdir / 'chapters'
    if not cdir.exists():
        continue
    rows = []
    for i, md in enumerate(sorted(cdir.glob('*.md')), 1):
        raw = md.read_text(encoding='utf-8')
        meta, _ = parse_frontmatter(raw)
        num = int(meta.get('chapter_num') or re.search(r'(\d+)', md.stem).group(1) or i)
        title = str(meta.get('title') or f'Глава {num}')
        text = plain(raw)
        words = len(re.findall(r'[A-Za-zА-Яа-яЁё0-9]+', text))
        rows.append({
            'id': f'ch-{num:03d}',
            'number': num,
            'title': title,
            'shortTitle': re.sub(r'^.*?арка,\s*', '', title, flags=re.I).strip(),
            'slug': slugify(title),
            'source': meta.get('source_original',''),
            'status': meta.get('status',''),
            'note': meta.get('translation_note',''),
            'words': words,
            'minutes': max(1, round(words/210)),
            'src': f'chapters/{md.name}',
            'text': text,
            'format': 'markdown'
        })
    rows.sort(key=lambda x: x['number'])
    (vdir / 'chapters.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'OK: {vdir / "chapters.json"} — {len(rows)} глав')
