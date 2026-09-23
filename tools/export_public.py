#!/usr/bin/env python3
"""Read-only public export: canonical human identities and re-encoded display assets."""
import argparse
import collections
import datetime
import hashlib
import html
import io
import json
import re
import sqlite3
import urllib.request
from pathlib import Path
from PIL import Image, ImageOps

OFFICIAL = 'https://comic.hypergryph.com/terra-historicus/comic/6253'
SPECIAL = {'npc', 'non-character', 'non_character', 'unknown'}


def official_catalog():
    request = urllib.request.Request(OFFICIAL, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(request, timeout=40) as response:
        document = response.read().decode('utf-8')
    by_url = {}
    for href, body in re.findall(r'<a[^>]+href="([^"]+/6253/episode/[^"]+)"[^>]*>(.*?)</a>', document):
        title = html.unescape(re.sub('<[^>]+>', '', body))
        match = re.match('「(.+?)」篇', title)
        if match:
            # SSR includes desktop and mobile lists; deduplicate by verified URL.
            by_url.setdefault(href, match[1] + '篇')
    if not by_url:
        raise ValueError('Official catalog could not be parsed; no links will be guessed')
    names = collections.defaultdict(list)
    for order, (href, title) in enumerate(reversed(list(by_url.items())), 1):
        names[title].append({'official_url': 'https://comic.hypergryph.com' + href, 'order': order})
    return names, len(by_url)


def encoded(path, allowed_root, size, quality):
    path = Path(path).resolve()
    path.relative_to(allowed_root.resolve())
    with Image.open(path) as original:
        image = ImageOps.exif_transpose(original).convert('RGBA')
        canvas = Image.new('RGBA', image.size, 'white')
        canvas.alpha_composite(image)
        image = canvas.convert('RGB')
        image.thumbnail(size, Image.Resampling.LANCZOS)
        output = io.BytesIO()
        image.save(output, format='WEBP', quality=quality, method=4)
        return output.getvalue(), image.size


def asset(output, group, public_id, data):
    digest = hashlib.sha256(data).hexdigest()[:16]
    safe_id = hashlib.sha256(str(public_id).encode()).hexdigest()[:16]
    relative = Path('media') / group / (safe_id + '-' + digest + '.webp')
    target = output / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        target.write_bytes(data)
    return '/' + relative.as_posix()


def export(database, raw_root, output):
    if output == database.parent or output == database.parent.parent:
        raise ValueError('Export output must be separate from the private project')
    catalog, catalog_size = official_catalog()
    c = sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True)
    c.row_factory = sqlite3.Row
    c.execute('PRAGMA query_only=ON')
    c.execute('BEGIN')
    characters = {r['character_id']: dict(r) for r in c.execute('SELECT * FROM characters')}
    episodes = [dict(r) for r in c.execute('SELECT * FROM episodes')]
    images = [dict(r) for r in c.execute('SELECT * FROM images WHERE active=1')]
    rows = [dict(r) for r in c.execute("""
        SELECT ci.instance_id,ci.crop_path,ci.tags,p.panel_id,p.bbox panel_bbox,
               ci.bbox instance_bbox,i.image_id,i.episode_id,i.path image_path,g.character_id
        FROM global_identities g JOIN character_instances ci USING(instance_id)
        JOIN panels p USING(panel_id) JOIN images i USING(image_id)
        WHERE g.state='confirmed' AND g.trusted=1 AND g.label_source='human'
          AND ci.active=1 AND p.active=1 AND i.active=1
    """)]
    c.rollback()
    c.close()

    def resolve(cid):
        seen = set()
        while cid in characters and characters[cid]['merged_into']:
            if cid in seen:
                raise ValueError('Identity merge cycle')
            seen.add(cid)
            cid = characters[cid]['merged_into']
        return cid

    active = {cid: row for cid, row in characters.items()
              if not row['merged_into'] and row['identity_kind'] == 'canonical'
              and row['status'] != 'retired_temporary'
              and row['canonical_name'].casefold() not in SPECIAL}
    aliases = collections.defaultdict(set)
    for cid, row in characters.items():
        target = resolve(cid)
        if target in active and cid != target and row['identity_kind'] == 'canonical':
            aliases[target].add(row['canonical_name'])

    public_episodes = []
    for e in episodes:
        title = e['episode_name'].split('_', 1)[-1]
        matches = catalog.get(title, [])
        if len(matches) != 1:
            raise ValueError('Ambiguous/missing official episode: ' + e['episode_name'])
        link = matches[0]
        prefix = re.match(r'^(\d+)_', e['episode_name'])
        if not prefix or int(prefix[1]) != link['order']:
            raise ValueError('Local and official order disagree: ' + e['episode_name'])
        public_episodes.append({'id': e['episode_id'], 'name': e['episode_name'], **link})
    public_episodes.sort(key=lambda e: e['order'])
    episode_order = {e['id']: e['order'] for e in public_episodes}
    image_order = {}
    for e in public_episodes:
        source_images = [image for image in images if image['episode_id'] == e['id']]
        source_images.sort(key=lambda image: [int(part) if part.isdigit() else part for part in re.split(r'(\d+)', Path(image['path']).name)])
        image_order.update({image['image_id']: i for i, image in enumerate(source_images)})

    output.mkdir(parents=True, exist_ok=True)
    instances, previews, exclusions, used_characters = [], {}, collections.Counter(), set()
    private_root = database.parent.parent
    problems = []
    for index, row in enumerate(rows):
        cid = resolve(row['character_id'])
        if cid not in active:
            exclusions['noncanonical_or_special'] += 1
            continue
        tags = json.loads(row['tags'] or '{}')
        if any(tags.get(flag) is True for flag in ('bad_crop', 'non_character', 'false_detection')):
            exclusions['bad_crop'] += 1
            continue
        try:
            if row['image_id'] not in previews:
                data, dimensions = encoded(row['image_path'], raw_root, (180, 640), 68)
                previews[row['image_id']] = asset(output, 'source-previews', row['image_id'], data)
            data, dimensions = encoded(row['crop_path'], private_root, (512, 512), 85)
            crop = asset(output, 'crops', row['instance_id'], data)
            panel_bbox, bbox = json.loads(row['panel_bbox']), json.loads(row['instance_bbox'])
            y, x = int(panel_bbox[1] + bbox[1]), int(panel_bbox[0] + bbox[0])
            instances.append({
                'id': row['instance_id'], 'character_id': cid, 'episode_id': row['episode_id'],
                'image_id': row['image_id'], 'crop_url': crop, 'source_preview_url': previews[row['image_id']],
                'sort_key': '%04d/%03d/%06d/%06d/%s' % (episode_order[row['episode_id']], image_order[row['image_id']], y, x, row['instance_id'])
            })
            used_characters.add(cid)
        except Exception as error:
            problems.append({'instance_id': row['instance_id'], 'error_type': type(error).__name__})
        if (index + 1) % 500 == 0:
            print('Processed %d / %d' % (index + 1, len(rows)), flush=True)
    report = {'human_confirmed_active': len(rows), 'public_instances': len(instances),
              'public_characters': len(used_characters), 'episodes': len(public_episodes),
              'images': len(images), 'previews': len(previews),
              'official_catalog_episodes': catalog_size, 'exclusions': dict(exclusions), 'problems': problems}
    (output.parent / 'export-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    if problems:
        raise ValueError('Asset export failed for %d instances; no release manifest published' % len(problems))
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    public_characters = [{'id': cid, 'name': active[cid]['canonical_name'], 'type': 'canonical',
                          'aliases': sorted(aliases[cid])} for cid in sorted(used_characters)]
    release = {
        'release_id': 'human-' + hashlib.sha256(json.dumps(instances, sort_keys=True).encode()).hexdigest()[:16],
        'generated_at': now, 'characters': public_characters, 'episodes': public_episodes,
        'instances': sorted(instances, key=lambda item: item['sort_key']),
        'images': [{'id': image['image_id']} for image in images],
        'cast_complete': False, 'featured_instance_ids': []
    }
    content = {key: value for key, value in release.items() if key not in ('release_id', 'generated_at')}
    release['release_id'] = 'human-' + hashlib.sha256(json.dumps(content, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:16]
    (output / 'data').mkdir(exist_ok=True)
    (output / 'data/release.json').write_text(json.dumps(release, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    report['asset_bytes'] = sum(p.stat().st_size for p in (output / 'media').rglob('*.webp'))
    (output.parent / 'export-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', required=True, type=Path)
    parser.add_argument('--raw-root', required=True, type=Path)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'publish/site')
    args = parser.parse_args()
    export(args.database, args.raw_root, args.output.resolve())
