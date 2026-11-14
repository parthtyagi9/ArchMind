"""Where an agent (or a memory search) is working: no workspace, one repository, or a repo group.

A group context makes repo-scoped memories of every repository in the group eligible, plus memories scoped to the group
itself. Org- and team-scoped memories are eligible everywhere (team still has to match the caller)."""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class MemoryContext:
    repo_ids: tuple[str, ...] = ()
    group_id: str | None = None
    repo_names: dict[str, str] = field(default_factory=dict, compare=False, hash=False)
    group_name: str | None = None

    @property
    def scoped(self) -> bool:
        return bool(self.repo_ids or self.group_id)

    def scope_labels(self) -> list[str]:
        out = [f"repo:{self.repo_names.get(r, r)}" for r in self.repo_ids]
        if self.group_id:
            out.append(f"group:{self.group_name or self.group_id}")
        return out


NONE = MemoryContext()
