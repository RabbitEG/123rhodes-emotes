"""Exercise actual editing/building in an isolated directory."""
import importlib.util
import json
import shutil
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('site_builder', str(ROOT / 'tools/build.py'))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

with tempfile.TemporaryDirectory(prefix='rhodes-copy-test-') as directory:
    target = Path(directory)
    for name in ('content', 'templates', 'config'):
        shutil.copytree(str(ROOT / name), str(target / name))
    for name in ('styles.css', 'background.js', 'app.js', 'stats.js', 'guestbook.js', 'guestbook-admin.js'):
        shutil.copyfile(str(ROOT / name), str(target / name))
    builder.ROOT = target
    path = target / 'content/copy.zh-CN.json'
    copy = json.loads(path.read_text(encoding='utf-8'))
    copy['stats.title']['text'] = '今日数据<b>&"'
    copy['site.name']['text'] = '测试站</script><script>alert(1)</script>'
    path.write_text(json.dumps(copy, ensure_ascii=False), encoding='utf-8')
    builder.build()
    assert not (target / 'config/selected-background.json').exists()
    output = (target / 'index.html').read_text(encoding='utf-8')
    assert '今日数据&lt;b&gt;&amp;&quot;' in output
    assert '<script>alert(1)</script>' not in output
    assert '\\u003c/script\\u003e' in output
    builder.build(check=True)
    config_path = target / 'config/site.json'
    config = json.loads(config_path.read_text(encoding='utf-8'))
    config['publicDataBaseUrl'] = 'https://media.example.test'
    config_path.write_text(json.dumps(config), encoding='utf-8')
    builder.build()
    headers = (target / '_headers').read_text(encoding='utf-8')
    assert "connect-src 'self' https://media.example.test;" in headers
    assert "img-src 'self' data: https://media.example.test;" in headers
    copy['search.crops']['text'] = '已删除占位符'
    path.write_text(json.dumps(copy, ensure_ascii=False), encoding='utf-8')
    try:
        builder.build()
    except ValueError as error:
        assert 'Preserve placeholders' in str(error)
    else:
        raise AssertionError('Missing placeholder should fail')
print('Copy editing, generation, escaping and placeholder protection passed')
