#!/usr/bin/env python3
"""Prepare full-resolution cover backdrops; optionally upload only those assets to R2."""
import argparse
import hashlib
import io
import json
import os
import re
from pathlib import Path

from PIL import Image, ImageOps

from upload_r2 import load_env

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent / '123罗德岛_官方原图/封面图'


def prepare(source, bundle):
    if not source.is_dir():
        raise ValueError('Cover source directory is missing: %s' % source)
    files = sorted(path for path in source.iterdir() if path.is_file() and path.suffix.lower() in ('.jpg', '.jpeg', '.png', '.webp'))
    if not files:
        raise ValueError('No cover images found')
    output = bundle / 'media/backgrounds'
    output.mkdir(parents=True, exist_ok=True)
    prepared = {}
    for path in files:
        with Image.open(path) as original:
            image = ImageOps.exif_transpose(original).convert('RGBA')
            canvas = Image.new('RGBA', image.size, 'white')
            canvas.alpha_composite(image)
            image = canvas.convert('RGB')
            image.thumbnail((1920, 1080), getattr(Image, 'Resampling', Image).LANCZOS)
            buffer = io.BytesIO()
            image.save(buffer, format='WEBP', quality=90, method=4)
        data = buffer.getvalue()
        name_hash = hashlib.sha256(path.name.encode('utf-8')).hexdigest()[:16]
        content_hash = hashlib.sha256(data).hexdigest()[:16]
        key = 'media/backgrounds/%s-%s.webp' % (name_hash, content_hash)
        target = bundle / key
        if not target.exists():
            target.write_bytes(data)
        elif target.read_bytes() != data:
            raise ValueError('Existing background hash collision: ' + key)
        prepared[key] = target
    return prepared


def upload(files, env_file):
    load_env(env_file)
    needed = ('R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY')
    if any(not os.environ.get(key) for key in needed):
        raise SystemExit('Configure R2 credentials in .env before --upload')
    account, bucket, access, secret = (os.environ[key] for key in needed)
    if not re.fullmatch('[0-9a-f]{32}', account):
        raise ValueError('Invalid R2 account ID')
    import boto3
    from botocore.config import Config
    from botocore.exceptions import ClientError
    client = boto3.client('s3', endpoint_url='https://' + account + '.r2.cloudflarestorage.com',
                          region_name='auto', aws_access_key_id=access, aws_secret_access_key=secret,
                          config=Config(retries={'max_attempts': 5, 'mode': 'standard'},
                                        request_checksum_calculation='when_required',
                                        response_checksum_validation='when_required'))
    uploaded = 0
    for key, path in files.items():
        try:
            existing = client.head_object(Bucket=bucket, Key=key)
        except ClientError as error:
            if error.response.get('Error', {}).get('Code') not in ('404', 'NoSuchKey', 'NotFound'):
                raise
        else:
            if existing['ContentLength'] == path.stat().st_size:
                continue
        client.upload_file(str(path), bucket, key, ExtraArgs={'ContentType': 'image/webp', 'CacheControl': 'public, max-age=31536000, immutable'})
        uploaded += 1
    return uploaded


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=SOURCE)
    parser.add_argument('--bundle', type=Path, default=ROOT / 'publish/site')
    parser.add_argument('--env-file', type=Path, default=ROOT / '.env')
    parser.add_argument('--upload', action='store_true')
    args = parser.parse_args()
    files = prepare(args.source.resolve(), args.bundle.resolve())
    uploaded = upload(files, args.env_file) if args.upload else 0
    print(json.dumps({'backgrounds': ['/' + key for key in files],
                      'total_bytes': sum(path.stat().st_size for path in files.values()),
                      'uploaded': uploaded}, ensure_ascii=False, indent=2))
