# ArchMind one-minute demo

A 60-second, 1920×1080, 30 fps Remotion film with actual ArchMind UI captures,
local synthesized narration, captions, and an original ambient score.

The story follows a Kafka producer reliability question through four sub-agents,
a human-approved demo-team policy, and a genuine with/without-memory comparison.
Screens are captured from the real frontend connected to the real FastAPI backend,
Atlas Vector Search, public Kafka Jira/Confluence, GitHub, and Gemini. The video is
an edited walkthrough using captured screens, with waiting time condensed—not an
uninterrupted screen recording. Displayed answers are backend results, never mocks.
The policy and recording identities are clearly labeled demonstration data.

The finished video, poster, captions, sanitized captures, and audio are included
so the demo can be viewed or re-rendered without reconnecting to Atlas. Other
temporary render outputs are excluded from Git:

- `out/archmind-demo.mp4`
- `out/archmind-poster.png`
- `out/archmind-captions.srt`
- `public/demo-results.json` — actual source counts and comparison outcome

## Edit and render existing captures

```sh
cd demo-video
npm ci
npm run typecheck
npm run studio
npm run render
```

Story, animation, crops, and timings live in `src/video.tsx`; the composition is
registered in `src/index.tsx`. `scripts/audio.py` generates narration with macOS's
Samantha voice and synthesizes the music locally. Re-run it after changing narration.
Rendering uses installed Google Chrome. Remotion packages are pinned to one version.

## Record a fresh run

The existing frontend should be running at `http://localhost:3000`. The recording
browser routes API calls to a separate backend on port 8011; it never redirects
other users' browser traffic. Set up from the backend directory so configuration
loads normally, without printing or copying `.env`:

```sh
cd backend
.venv/bin/python ../demo-video/scripts/setup-demo.py
.venv/bin/python ../demo-video/scripts/demo-backend.py
```

In another terminal:

```sh
cd demo-video
npm run capture
python3 scripts/audio.py
node scripts/render.mjs --stills
npm run render
```

Setup creates a separate `archmind_video_demo_<suffix>` Atlas database. It copies
only a focused public Kafka source snapshot, creates synthetic owner/member accounts,
and proposes an explicitly illustrative team policy as pending. Public sources are
checked anonymously. Capture performs real investigation, approval, governed retrieval,
and comparison calls. It fails rather than inventing successful output.

`recording-state.json` contains a demo-session cookie and is ignored by Git. Do not
publish it. Existing users, integration credentials, memories and workspace data are
never copied into the recording environment. Generated captures contain only public
Kafka material and synthetic demonstration identities/policies.

After recording and verification, stop the recording backend and optionally run
`scripts/cleanup-demo.py` from `backend/` to delete only the freshly created demo
database. The cleanup script refuses any other database name.

References: [Remotion](https://www.remotion.dev/),
[rendering API](https://www.remotion.dev/docs/renderer/render-media),
[Apache Kafka source](https://github.com/apache/kafka).
