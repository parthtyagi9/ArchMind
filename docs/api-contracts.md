# API (all under /api; all except health/session require the session cookie)

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | /health | – | Mongo ping, model config |
| GET | /session/users | – | demo directory |
| POST | /session/login `{user_id}` | – | sets signed httpOnly cookie |
| GET | /session/me | any | |
| POST | /incidents `{service, environment, error_code, description}` | responder | tenant from session; body `tenant_id` ignored |
| GET | /incidents | any | tenant-scoped |
| POST | /incidents/{id}/runs `{memory_enabled}` | responder | runs until resolved / awaiting_approval / failed |
| GET | /runs/{id} | any | steps, retrieved memories, verification, metrics |
| POST | /runs/{id}/approve · /reject `{comment}` | approver | resumes the graph |
| POST | /incidents/{id}/experiment | approver | A/B, returns both arms + summary |
| GET | /simulator · POST /simulator/reset | any / responder | |
| GET | /tools | – | allowlisted registry with JSON schemas |
| GET | /memories · /memories/{id}/history | any | never returns embeddings |
| POST | /memories/search `{query}` | any | governed `$vectorSearch` |
| POST | /memories/{id}/correct `{content, resolution_action?, reason}` | memory_admin | new version, re-embedded |
| POST | /memories/{id}/invalidate · /purge `{reason}` | memory_admin | |
| GET | /audit?run_id=&incident_id=&memory_id= | any | |
| GET | /experiments | any | |
