"""Local narration and an original, quiet ambient score. No external audio service."""
import array
import json
import math
import subprocess
import wave
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/"public/audio"
OUT.mkdir(parents=True,exist_ok=True)
NARRATION=[
    ("intro",5,"Code tells you what happens. ArchMind uncovers why, and remembers the rules."),
    ("connect",7,"Connect a repository and paste public Jira and Confluence links. No API tokens for public sources."),
    ("investigate",9,"Select code and ask why. GitHub, Jira, Confluence, and Memory agents gather evidence in parallel."),
    ("answer",7,"Get concrete guidance, with each agent's retrieved evidence available to inspect."),
    ("approve",8,"Knowledge starts as a proposal. A human approves its scope, provenance, and expiry."),
    ("compare",12,"Then ask the same question with and without memory. Shared evidence makes the difference visible. Here, an approved demo policy adds organizational constraints to the guidance."),
    ("govern",7,"Atlas filters memory by tenant, scope, status, and expiry. Correct it, or revoke it from retrieval."),
    ("outro",5,"ArchMind. Understand the decision. Govern what your agent remembers."),
]
results=ROOT/'public/demo-results.json'
if results.exists() and not json.loads(results.read_text())['comparison']['changed']:
    NARRATION=[(name,seconds,"Ask the same question with and without memory. This time both runs reach the same conclusion. ArchMind reports no change instead of inventing an impact." if name=='compare' else text) for name,seconds,text in NARRATION]
(OUT/'narration.json').write_text(json.dumps(NARRATION,indent=2))
for name,seconds,text in NARRATION:
    aiff=OUT/f"{name}.aiff"
    wav=OUT/f"{name}.wav"
    # Fit each segment comfortably, leaving a short breath before the next scene.
    rate=max(164,int(len(text.split())*60/(seconds-0.4)))
    subprocess.run(["say","-v","Samantha","-r",str(rate),"-o",str(aiff),text],check=True)
    subprocess.run(["afconvert","-f","WAVE","-d","LEI16",str(aiff),str(wav)],check=True)
    with wave.open(str(wav)) as w:
        duration=w.getnframes()/w.getframerate()
    for _ in range(4):
        if duration<=seconds-0.2:
            break
        rate=int(rate*duration/(seconds-0.4))+8
        subprocess.run(["say","-v","Samantha","-r",str(rate),"-o",str(aiff),text],check=True)
        subprocess.run(["afconvert","-f","WAVE","-d","LEI16",str(aiff),str(wav)],check=True)
        with wave.open(str(wav)) as w:
            duration=w.getnframes()/w.getframerate()
    assert duration<seconds, f"Narration exceeds scene: {name}"
    aiff.unlink()
    print(f"Narration: {name}",flush=True)

rate=24000
samples=array.array('h')
chords=[(130.813,164.814,195.998,246.942),(110,164.814,220,261.626),(87.307,130.813,174.614,220),(97.999,146.832,195.998,246.942)]
for i in range(rate*60):
    t=i/rate
    chord=chords[min(int(t//8),7)%4]
    env=min(1,t/2,(60-t)/3)
    pad=sum(math.sin(2*math.pi*freq*t+0.12*math.sin(t*0.3+j))*0.055 for j,freq in enumerate(chord))
    pulse=math.sin(2*math.pi*chord[0]*2*t)*math.exp(-((t*1.5)%1)*10)*0.045
    samples.append(int((pad+pulse)*env*21000))
with wave.open(str(OUT/'score.wav'),'wb') as w:
    w.setnchannels(1);w.setsampwidth(2);w.setframerate(rate);w.writeframes(samples.tobytes())
print('Original ambient score generated.',flush=True)
