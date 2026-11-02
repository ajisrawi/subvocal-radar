"""Voiceover for the Subvocal Radar video: one clip per scene from script.json (Microsoft neural voice via edge-tts).
The free endpoint drops requests now and then, so each line is retried. Avoid '...' in lines: the service rejects it.
Writes build/vo/<scene>.wav (48 kHz mono) and build/vo/durations.json."""
import json, os, re, subprocess, sys, time
import imageio_ffmpeg

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'build', 'vo')
os.makedirs(OUT, exist_ok=True)
S = json.load(open(os.path.join(HERE, 'script.json'), encoding='utf-8'))
ff = imageio_ffmpeg.get_ffmpeg_exe()
durs = {}
for sc in S['scenes']:
    mp3, wav = os.path.join(OUT, sc['id'] + '.mp3'), os.path.join(OUT, sc['id'] + '.wav')
    for attempt in range(8):
        r = subprocess.run([sys.executable, '-m', 'edge_tts', '--voice', S['voice'], '--text', sc['vo'], '--write-media', mp3], capture_output=True, text=True)
        if r.returncode == 0 and os.path.getsize(mp3) > 2000: break
        time.sleep(2 + 2 * attempt)
    else:
        sys.exit(f"no audio for scene {sc['id']}")
    subprocess.run([ff, '-y', '-loglevel', 'error', '-i', mp3, '-ac', '1', '-ar', '48000', wav], check=True)
    info = subprocess.run([ff, '-i', wav], capture_output=True, text=True).stderr
    m = re.search(r'Duration: (\d+):(\d+):([\d.]+)', info)
    durs[sc['id']] = int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3])
    print(f"{sc['id']:9s} {durs[sc['id']]:5.2f}s")
json.dump(durs, open(os.path.join(OUT, 'durations.json'), 'w'), indent=1)
