"""Validate upload ordering and rejection without R2 credentials/network."""
import importlib.util
import hashlib
import json
import os
import sqlite3
import sys
import tempfile
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('uploader', str(ROOT / 'tools/upload_r2.py'))
uploader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(uploader)
export_spec = importlib.util.spec_from_file_location('public_exporter', str(ROOT / 'tools/export_public.py'))
exporter = importlib.util.module_from_spec(export_spec)
export_spec.loader.exec_module(exporter)

def test_reviewed_character_traits():
    connection = sqlite3.connect(':memory:')
    connection.row_factory = sqlite3.Row
    connection.executescript('''
        CREATE TABLE character_genders(character_id TEXT,human_value TEXT,human_reviewed INTEGER);
        CREATE TABLE character_hair_colors(character_id TEXT,human_color TEXT,review_status TEXT);
        INSERT INTO character_genders VALUES('c1','女',1),('c2','男',0);
        INSERT INTO character_hair_colors VALUES('c1','black','confirmed'),('c2','red','candidate');
    ''')
    traits = exporter.reviewed_character_traits(connection)
    assert traits['gender'] == [{'character_id': 'c1', 'value': '女'}]
    assert traits['hair_color'] == [{'character_id': 'c1', 'value': 'black'}]
    characters = {'c1': {'identity_kind': 'canonical'}, 'old': {'identity_kind': 'canonical'}}
    active = {'c1': {}}
    resolve = lambda cid: 'c1' if cid == 'old' else cid
    assert exporter.canonical_attribute_values(traits['gender'], characters, active, resolve) == {'c1': '女'}
    assert exporter.canonical_attribute_values(
        [{'character_id': 'c1', 'value': '女'}, {'character_id': 'old', 'value': '男'}],
        characters, active, resolve) == {}
    legacy = sqlite3.connect(':memory:')
    assert exporter.reviewed_character_traits(legacy) == {'gender': [], 'hair_color': []}
    connection.close()
    legacy.close()

test_reviewed_character_traits()

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
        release = {'release_id':'test', 'characters':[{'id':'c1','gender':'女','hair_color':'black'}], 'episodes':[], 'images':[],
                   'operator_forms':[{'character_id':'c1','name':'测试角色','is_alter':False,'implementation_date':'2020-01-01'}],
                   'instances':[{'crop_url':'/' + asset, 'source_preview_url':'/' + asset}]}
        manifest = bundle / 'data/release.json'
        manifest.write_text(json.dumps(release), encoding='utf-8')
        uploader.upload(bundle, True, False, bundle / '.env')
        assert not client.calls
        uploader.upload(bundle, False, False, bundle / '.env')
        assert client.calls == [('asset', asset), ('index', 'data/release.json')]
        client.calls.clear()
        release['characters'][0]['gender'] = 3
        manifest.write_text(json.dumps(release), encoding='utf-8')
        try:
            uploader.files_for(bundle)
        except ValueError as error:
            assert 'Invalid character metadata' in str(error)
        else:
            raise AssertionError('Malformed optional character metadata should be rejected')
        release['characters'][0]['gender'] = '女'
        manifest.write_text(json.dumps(release), encoding='utf-8')
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
        release['operator_forms'][0]['is_alter'] = 'false'
        manifest.write_text(json.dumps(release), encoding='utf-8')
        try:
            uploader.files_for(bundle)
        except ValueError as error:
            assert 'Invalid operator form metadata' in str(error)
        else:
            raise AssertionError('Malformed operator form metadata should be rejected')
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
