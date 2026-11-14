"""Remove only the isolated database created by setup-demo.py. Keep captured assets."""
import json
import re
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'backend'))
from app.db import get_db

state_file=ROOT/'demo-video/recording-state.json'
state=json.loads(state_file.read_text())
name=state['database']
if not re.fullmatch(r'archmind_video_demo_[a-f0-9]{8}',name):
    raise SystemExit('Refusing to delete a database outside the isolated recording namespace.')
get_db().client.drop_database(name)
state_file.unlink()
print('Removed isolated recording database and demo-session state. Captures and rendered video remain.')
