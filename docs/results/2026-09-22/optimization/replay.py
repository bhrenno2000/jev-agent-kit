import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

parser = argparse.ArgumentParser(description='Replay the archived optimization outputs and original acceptance checks.')
parser.add_argument('--artifacts', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
artifacts = Path(args.artifacts).resolve()
output = Path(args.output).resolve()
output.mkdir(parents=True, exist_ok=False)
report = json.loads((artifacts / 'report.json').read_text())
manifest = json.loads((artifacts / 'trace-manifest.json').read_text())
results = []
for row in report['trials']:
    name = row['name']
    target = output / name
    shutil.copytree(artifacts / 'frozen' / row['level'] / row['variant'], target)
    patch = artifacts / 'trials' / name / 'solution.patch'
    if patch.stat().st_size:
        applied = subprocess.run(['git', 'apply', str(patch)], cwd=target, capture_output=True, text=True)
        if applied.returncode:
            raise RuntimeError(name + ': ' + applied.stderr)
    actual = {str(p.relative_to(target)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(target.rglob('*')) if p.is_file()}
    env = {name: os.environ[name] for name in ('PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM') if name in os.environ}
    env['BENCH_WORKSPACE'] = str(target)
    checked = subprocess.run([shutil.which('node'), '--test', str(artifacts / 'frozen' / row['level'] / 'checks/acceptance.test.mjs')], capture_output=True, text=True, env=env, timeout=60)
    (output / (name + '.tap')).write_text(checked.stdout + checked.stderr)
    counts = {}
    for label in ('tests', 'pass', 'fail', 'skipped', 'cancelled'):
        matches = re.findall(r'^# ' + label + r' (\d+)$', checked.stdout, re.M)
        counts[label] = int(matches[-1]) if matches else None
    passed = checked.returncode == 0 and bool(counts['tests']) and counts['tests'] == counts['pass'] and counts['skipped'] == counts['cancelled'] == 0
    results.append({'trial':name, 'workspaceHashMatch':actual == manifest[name]['workspaceHashes'], 'acceptanceOutcomeMatch':passed == row['acceptance']['passed'], 'acceptanceCountsMatch':counts == row['acceptance']['counts']})
result = {'trials':results, 'allWorkspaceHashesMatch':all(x['workspaceHashMatch'] for x in results), 'allAcceptanceOutcomesMatch':all(x['acceptanceOutcomeMatch'] and x['acceptanceCountsMatch'] for x in results)}
(output / 'patch-replay.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
if not result['allWorkspaceHashesMatch'] or not result['allAcceptanceOutcomesMatch']:
    raise SystemExit(1)
