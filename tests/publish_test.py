"""Validate upload ordering and rejection without R2 credentials/network."""
import importlib.util
import hashlib
import json
import os
import sys
import tempfile
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('uploader', str(ROOT / 'tools/upload_r2.py'))
uploader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(uploader)

class Client:
    def __init__(self):
        self.calls = []
        self.fail = False
    def get_paginator(self, name):
        assert name == 'list_objects_v2'
        return self
    def paginate(self, **kwargs):
        return [{'Contents': []}]
    def upload_file(self, filename, bucket, key, **kwargs):
        if self.fail:
            raise RuntimeError('simulated upload failure')
        self.calls.append(('asset', key))
    def put_object(self, **kwargs):
        self.calls.append(('index', kwargs['Key']))
    def put_bucket_cors(self, **kwargs):
        self.calls.append(('cors', 'configured'))

client = Client()
sys.modules['boto3'] = types.SimpleNamespace(client=lambda *args, **kwargs: client)
sys.modules['botocore.config'] = types.SimpleNamespace(Config=lambda **kwargs: kwargs)
keys = {'R2_ACCOUNT_ID': '0' * 32, 'R2_BUCKET': 'synthetic-test', 'R2_ACCESS_KEY_ID': 'fake-test-id', 'R2_SECRET_ACCESS_KEY': 'fake-test-key'}
previous = {key: os.environ.get(key) for key in keys}
os.environ.update(keys)
try:
    with tempfile.TemporaryDirectory(prefix='rhodes-publish-test-') as directory:
        bundle = Path(directory)
        data = b'synthetic bytes only'
        digest = hashlib.sha256(data).hexdigest()[:16]
        asset = 'media/crops/' + '0' * 16 + '-' + digest + '.webp'
        path = bundle / asset
        path.parent.mkdir(parents=True)
        path.write_bytes(data)
        (bundle / 'data').mkdir()
        release = {'release_id':'test', 'characters':[], 'episodes':[], 'images':[],
                   'instances':[{'crop_url':'/' + asset, 'source_preview_url':'/' + asset}]}
        manifest = bundle / 'data/release.json'
        manifest.write_text(json.dumps(release), encoding='utf-8')
        uploader.upload(bundle, True, False, bundle / '.env')
        assert not client.calls
        uploader.upload(bundle, False, False, bundle / '.env')
        assert client.calls == [('asset', asset), ('index', 'data/release.json')]
        client.calls.clear()
        client.fail = True
        try:
            uploader.upload(bundle, False, False, bundle / '.env')
        except RuntimeError:
            pass
        else:
            raise AssertionError('Expected upload failure')
        assert not client.calls
        path.write_bytes(b'changed')
        try:
            uploader.files_for(bundle)
        except ValueError as error:
            assert 'hash mismatch' in str(error)
        else:
            raise AssertionError('Hash mismatch should be rejected')
        release['private_database'] = 'not allowed'
        manifest.write_text(json.dumps(release), encoding='utf-8')
        try:
            uploader.files_for(bundle)
        except ValueError as error:
            assert 'Unexpected manifest fields' in str(error)
        else:
            raise AssertionError('Private field should be rejected')
finally:
    for key, value in previous.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value
print('Upload dry-run, assets-before-index, failure isolation, hash and field whitelist checks passed')
