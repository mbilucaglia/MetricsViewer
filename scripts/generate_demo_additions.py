"""Rebuild synthetic demo additions while preserving the original XLSX-derived metrics."""
import json, math, random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / 'metrics_demo_2_stimoli.json'
data = json.loads(path.read_text(encoding='utf-8'))
for subject, recording in enumerate(data['recordings']):
    recording['epochs'] = [e for e in recording['epochs'] if e['id'] != 'baseline']
    rng = random.Random(20261116 + subject)
    baseline = {'id': 'baseline', 'metrics': {}}
    original_names = [k for k in recording['epochs'][0]['metrics'] if not k.endswith('_60Hz')]
    for name in original_names:
        baseline['metrics'][name] = {
            'time': [i / 2 for i in range(1, 21)],
            'values': [round(.1 + .025 * math.sin(i * .5 + subject) + rng.gauss(0, .035), 6) for i in range(1, 21)]
        }
    recording['epochs'].append(baseline)
    for epoch_index, epoch in enumerate(recording['epochs']):
        duration = 10 if epoch['id'] == 'baseline' else data['demo_info']['videos'][epoch['id']]['duration_s']
        for metric_index, name in enumerate(['AWI_60Hz', 'WL_60Hz']):
            rng = random.Random(20261116 + subject * 100 + epoch_index * 10 + metric_index)
            time = [round(i / 60, 9) for i in range(1, round(duration * 60) + 1)]
            phase = rng.uniform(0, 2 * math.pi)
            offset = rng.gauss(.1, .04)
            values = []
            for t in time:
                activity = 0 if epoch['id'] == 'baseline' else .12 * math.exp(-((t - duration * .45) / (duration * .18)) ** 2)
                value = offset + .04 * math.sin(2 * math.pi * .8 * t + phase) + .015 * math.sin(2 * math.pi * 3.7 * t + phase) + activity + rng.gauss(0, .012)
                values.append(round(value, 6))
            epoch['metrics'][name] = {'time': time, 'values': values}

data['demo_info']['videos']['baseline'] = {'file': 'video_demo_baseline.mp4', 'duration_s': 10, 'offset_s': 0}
data['demo_info']['description'] = 'Dati sintetici, non EEG reali. Le 8 metriche degli stimoli originali sono preservate dal foglio Excel. Baseline di 10 s e AWI_60Hz/WL_60Hz generate separatamente, non interpolate dai dati originali.'
data['demo_info']['generated_additions'] = {'script': 'scripts/generate_demo_additions.py', 'seed': 20261116, 'baseline_duration_s': 10, 'high_resolution_metrics': ['AWI_60Hz', 'WL_60Hz'], 'sampling_rate_hz': 60}
serialized = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
path.write_text(serialized + '\n', encoding='utf-8')
(ROOT / 'js/demo-data.js').write_text('// Bundled copy of metrics_demo_2_stimoli.json; supports opening index.html directly.\n(function(root){root.MetricsDemo={createDataset:()=>(' + serialized + ')};})(globalThis);\n', encoding='utf-8')
print(f'Updated demo: {len(data["recordings"])} subjects, 3 epochs, 10 metrics; {len(serialized):,} characters.')
