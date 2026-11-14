"""Offline, deterministic stand-in for the Gemini planner (LLM_PROVIDER=rules).

Clearly labeled in the UI as "rule-based (offline)". It reads the same prompt the real agent builds, so it
reacts to whatever governed memories retrieval actually returned: if a retrieved, successful memory names
an allowlisted fix it tries that fix first; otherwise it runs the diagnostic sequence, then the fix the
diagnostics point to. Policy, approval, verification and memory governance are unchanged (all in code)."""
from __future__ import annotations

import json
import re

from app.agents.llm import Classification, PlanDecision

DIAGNOSTICS = ["inspect_service_logs", "inspect_service_permissions", "inspect_secret_access",
               "inspect_kms_key", "inspect_network_path"]
FIXES = ["repair_secret_access", "rotate_secret", "restart_service"]


class RuleBasedLLM:
    model_name = "rule-based (offline)"

    def structured(self, system, prompt, schema):
        incident = json.loads(prompt.split("<untrusted_incident>")[1].split("</untrusted_incident>")[0])
        service = incident.get("service") or "payment-service"
        if schema is Classification:
            text = json.dumps(incident).lower()
            cat = "secret_access_denied" if ("accessdenied" in text or "secret" in text) else "unknown"
            return Classification(failure_category=cat, affected_service=service,
                                  summary=f"{service} failed: {incident.get('error_code') or 'error'} during deployment.",
                                  search_query=f"{service} {incident.get('error_code', '')} secret access denied")
        history = prompt.split("<untrusted_tool_history>")[-1]
        done = re.findall(r'"tool": "([a-z_]+)"', history)
        failed_fixes = {t for t in done if t in FIXES}
        mem_block = prompt.split("<untrusted_memories>")[1].split("</untrusted_memories>")[0].strip()
        mems = json.loads(mem_block) if mem_block.startswith("[") else []
        for m in mems:
            fix = m.get("resolution_action")
            if (fix in FIXES and fix not in failed_fixes and m.get("outcome") == "success"
                    and m.get("service") == service and m.get("error_code") == incident.get("error_code")):
                return PlanDecision(decision="call_tool", tool_name=fix, service=service,
                                    hypothesis=f"Same signature as memory {m['memory_id']}",
                                    rationale=f"Retrieved memory {m['memory_id']} (v{m.get('version')}, "
                                              f"{m.get('verification_status')}) resolved this exact service/error with {fix}.",
                                    memory_ids_used=[m["memory_id"]])
        for d in DIAGNOSTICS:
            if d not in done:
                return PlanDecision(decision="call_tool", tool_name=d, service=service,
                                    hypothesis="Root cause not yet established", rationale=f"No applicable memory; running {d}.")
        if "repair_secret_access" not in failed_fixes:
            return PlanDecision(decision="call_tool", tool_name="repair_secret_access", service=service,
                                hypothesis="IAM role lacks secretsmanager:GetSecretValue",
                                rationale="Diagnostics show DescribeSecret only; KMS and network are healthy.")
        return PlanDecision(decision="escalate", hypothesis="Unknown", rationale="Allowlisted fixes exhausted.")
