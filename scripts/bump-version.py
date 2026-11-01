#!/usr/bin/env python3
"""Stamp a new version on all FieldPack files (run before each release).

Browsers and GitHub Pages cache files for a few minutes; giving every file a
new ?v= stamp makes sure visitors never get a mix of old and new files.
Usage: python3 scripts/bump-version.py
"""
import datetime, glob, os, re

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
version = datetime.datetime.now().strftime('%Y%m%d%H%M')
for f in glob.glob(os.path.join(root, 'js', '*.js')):
    t = open(f, encoding='utf-8').read()
    n = re.sub(r"(from\s+'\./[\w-]+\.js)(\?v=\w+)?'", lambda m: f"{m.group(1)}?v={version}'", t)
    if n != t:
        open(f, 'w', encoding='utf-8').write(n)
idx = os.path.join(root, 'index.html')
t = open(idx, encoding='utf-8').read()
t = re.sub(r'(js/app\.js|css/styles\.css)(\?v=\w+)?"', lambda m: f'{m.group(1)}?v={version}"', t)
open(idx, 'w', encoding='utf-8').write(t)
print('FieldPack version', version)
