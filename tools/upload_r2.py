#!/usr/bin/env python3
"""Upload only exported public assets to R2; publish the index last. Never delete objects."""
import argparse
import hashlib
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_env(path):
    if not path.exists():
        return
    allowed = {'R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'}
    for line in path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        key, separator, value = line.partition('=')
        if separator and key.strip() in allowed:
            os.environ.setdefault(key.strip(), value.strip().strip('\"').strip("'"))


def files_for(bundle):
    manifest = bundle / 'data/release.json'
    release = json.loads(manifest.read_text(encoding='utf-8'))
    allowed = {'release_id', 'generated_at', 'characters', 'episodes', 'instances', 'images', 'cast_complete', 'featured_instance_ids'}
    if set(release) - allowed:
        raise ValueError('Unexpected manifest fields')
    allowed_rows = {
        'characters': {'id', 'name', 'type', 'aliases'},
        'episodes': {'id', 'name', 'official_url', 'order', 'cast_character_ids'},
        'instances': {'id', 'character_id', 'episode_id', 'image_id', 'crop_url', 'source_preview_url', 'sort_key'},
        'images': {'id'}
    }
    for name, keys in allowed_rows.items():
        if not isinstance(release.get(name), list):
            raise ValueError('Invalid manifest table: ' + name)
        for row in release[name]:
            if set(row) - keys:
                raise ValueError('Unexpected fields in ' + name)
    keys = set()
    for item in release['instances']:
        for field in ('crop_url', 'source_preview_url'):
            key = item[field].lstrip('/')
            if not re.fullmatch(r'media/(crops|source-previews)/[0-9a-f]{16}-[0-9a-f]{16}\.webp', key):
                raise ValueError('Not a re-encoded public asset')
            keys.add(key)
    paths = {}
    for key in sorted(keys):
        path = (bundle / key).resolve()
        path.relative_to(bundle.resolve())
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest()[:16] != path.stem.split('-')[-1]:
            raise ValueError('Asset content hash mismatch: ' + key)
        paths[key] = path
    return manifest, paths


def upload(bundle, dry_run, configure_cors, env_file):
    manifest, files = files_for(bundle)
    total = sum(path.stat().st_size for path in files.values()) + manifest.stat().st_size
    print(json.dumps({'assets': len(files), 'manifest_bytes': manifest.stat().st_size, 'total_bytes': total, 'dry_run': dry_run}))
    if dry_run:
        return
    load_env(env_file)
    needed = ('R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY')
    missing = [key for key in needed if not os.environ.get(key)]
    if missing:
        raise SystemExit('Configure in .env (do not paste secrets into chat): ' + ', '.join(missing))
    account, bucket, access, secret = (os.environ[key] for key in needed)
    if not re.fullmatch('[0-9a-f]{32}', account):
        raise ValueError('Invalid R2 account ID')
    import boto3
    from botocore.config import Config
    client = boto3.client('s3', endpoint_url='https://' + account + '.r2.cloudflarestorage.com',
                          region_name='auto', aws_access_key_id=access, aws_secret_access_key=secret,
                          config=Config(retries={'max_attempts': 5, 'mode': 'standard'},
                                        request_checksum_calculation='when_required',
                                        response_checksum_validation='when_required'))
    if configure_cors:
        rules = json.loads((ROOT / 'config/r2-cors.json').read_text(encoding='utf-8'))
        client.put_bucket_cors(Bucket=bucket, CORSConfiguration=rules)
    existing = {}
    for page in client.get_paginator('list_objects_v2').paginate(Bucket=bucket, Prefix='media/'):
        existing.update({obj['Key']: obj['Size'] for obj in page.get('Contents', [])})
    uploaded = skipped = 0
    for key, path in files.items():
        if existing.get(key) == path.stat().st_size:
            skipped += 1
            continue
        client.upload_file(str(path), bucket, key, ExtraArgs={'ContentType': 'image/webp', 'CacheControl': 'public, max-age=31536000, immutable'})
        uploaded += 1
        if uploaded % 250 == 0:
            print('Uploaded %d assets' % uploaded, flush=True)
    client.put_object(Bucket=bucket, Key='data/release.json', Body=manifest.read_bytes(),
                      ContentType='application/json; charset=utf-8', CacheControl='public, max-age=60, must-revalidate')
    print(json.dumps({'uploaded': uploaded, 'unchanged': skipped, 'manifest_published': True}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, default=ROOT / 'publish/site')
    parser.add_argument('--env-file', type=Path, default=ROOT / '.env')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--configure-cors', action='store_true')
    args = parser.parse_args()
    upload(args.bundle.resolve(), args.dry_run, args.configure_cors, args.env_file)
