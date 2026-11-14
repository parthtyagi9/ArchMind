"""Create collections, schema validation, indexes and the Atlas Vector Search index. Safe to re-run.

Run:  cd backend && python -m scripts.create_indexes
"""
from __future__ import annotations

import time

from pymongo import ASCENDING, DESCENDING, IndexModel
from pymongo.errors import CollectionInvalid, OperationFailure
from pymongo.operations import SearchIndexModel

from app.config import get_settings
from app.db import COLLECTIONS, get_db

MEMORY_SCHEMA = {"$jsonSchema": {
    "bsonType": "object",
    "required": ["memory_id", "version", "tenant_id", "memory_type", "scope", "status", "authority", "created_at", "updated_at", "expires_at"],
    "properties": {
        "tenant_id": {"bsonType": "string", "minLength": 1},
        "memory_id": {"bsonType": "string"},
        "version": {"bsonType": "int", "minimum": 1},
        "status": {"enum": ["pending", "active", "superseded", "invalidated", "rejected", "purged"]},
        "scope": {"enum": ["org", "repo", "team", "group"]},
        "authority": {"enum": ["agent_observed", "human", "verified"]},
        "memory_type": {"bsonType": "string"},
        "content": {"bsonType": "string"},
        "embedding": {"bsonType": "array"},
        "expires_at": {"bsonType": "date"},
    }}}

AUDIT_SCHEMA = {"$jsonSchema": {"bsonType": "object", "required": ["type", "actor_id", "created_at"], "properties": {"type": {"bsonType": "string"}}}}


def vector_index_definition(dims: int) -> dict:
    """Every field the governance filter uses must be declared here, or it cannot pre-filter inside $vectorSearch."""
    return {"fields": [
        {"type": "vector", "path": "embedding", "numDimensions": dims, "similarity": "cosine"},
        {"type": "filter", "path": "tenant_id"},
        {"type": "filter", "path": "status"},
        {"type": "filter", "path": "expires_at"},
        {"type": "filter", "path": "scope"},
        {"type": "filter", "path": "team"},
        {"type": "filter", "path": "repo_id"},
        {"type": "filter", "path": "group_id"},
    ]}


def main() -> None:
    s = get_settings()
    db = get_db()
    existing = set(db.list_collection_names())
    for name in COLLECTIONS:
        if name not in existing:
            try:
                db.create_collection(name)
            except CollectionInvalid:
                pass
    db.command("collMod", "memories", validator=MEMORY_SCHEMA, validationLevel="moderate")
    db.command("collMod", "audit_events", validator=AUDIT_SCHEMA, validationLevel="moderate")

    for name, coll in (("source_text", db.source_documents),):
        if name in {ix["name"] for ix in coll.list_indexes()}:
            opts = next(ix for ix in coll.list_indexes() if ix["name"] == name)
            if opts.get("language_override") != "_text_lang":
                coll.drop_index(name)  # recreate with the corrected options
    db.users.create_indexes([
        IndexModel([("email", ASCENDING)], unique=True),
        IndexModel([("github.id", ASCENDING)], unique=True, name="github_id", partialFilterExpression={"github.id": {"$exists": True}}),
    ])
    db.memberships.create_indexes([IndexModel([("user_id", ASCENDING), ("org_id", ASCENDING)], unique=True), IndexModel([("org_id", ASCENDING)])])
    db.invites.create_indexes([IndexModel([("org_id", ASCENDING)]), IndexModel([("expires_at", ASCENDING)], expireAfterSeconds=86400, name="invite_cleanup")])
    db.repos.create_indexes([IndexModel([("org_id", ASCENDING), ("full_name", ASCENDING)], unique=True)])
    db.repo_groups.create_indexes([IndexModel([("org_id", ASCENDING), ("name", ASCENDING)], unique=True),
                                   IndexModel([("org_id", ASCENDING), ("repo_ids", ASCENDING)])])
    db.source_documents.create_indexes([
        IndexModel([("repo_id", ASCENDING), ("path", ASCENDING)], unique=True),
        # `language_override` points at a field our documents do not have: the default ("language") collides with our own
        # `language` field, whose values like "text" are not valid Mongo text-search languages.
        IndexModel([("path", "text"), ("content", "text")], name="source_text", default_language="none", language_override="_text_lang",
                   weights={"path": 5, "content": 1}),
    ])
    db.memories.create_indexes([
        IndexModel([("tenant_id", ASCENDING), ("memory_id", ASCENDING), ("version", ASCENDING)], unique=True),
        # Exactly one active version per lineage: a concurrent correction cannot leave two live versions.
        IndexModel([("memory_id", ASCENDING)], unique=True, name="one_active_version", partialFilterExpression={"status": "active"}),
        IndexModel([("tenant_id", ASCENDING), ("status", ASCENDING), ("expires_at", ASCENDING)]),
    ])
    db.agent_runs.create_indexes([IndexModel([("tenant_id", ASCENDING), ("created_at", DESCENDING)]), IndexModel([("tenant_id", ASCENDING), ("repo_id", ASCENDING)]),
                                 IndexModel([("tenant_id", ASCENDING), ("group_id", ASCENDING)])])
    db.compares.create_index([("tenant_id", ASCENDING), ("created_at", DESCENDING)])
    db.audit_events.create_indexes([
        IndexModel([("tenant_id", ASCENDING), ("created_at", DESCENDING)]),
        IndexModel([("tenant_id", ASCENDING), ("memory_id", ASCENDING)]),
        IndexModel([("tenant_id", ASCENDING), ("run_id", ASCENDING)]),
    ])
    db.code_chunks.create_indexes([IndexModel([("repo_id", ASCENDING), ("path", ASCENDING), ("start_line", ASCENDING)]),
                                   IndexModel([("repo_id", ASCENDING), ("hash", ASCENDING)])])
    print("collections, validators and indexes ready")

    ensure_vector_index(db.memories, s.vector_index_name, vector_index_definition(s.embedding_dimensions))
    ensure_vector_index(db.code_chunks, s.code_vector_index_name, code_vector_index_definition(s.code_embedding_dimensions))


def code_vector_index_definition(dims: int) -> dict:
    return {"fields": [
        {"type": "vector", "path": "embedding", "numDimensions": dims, "similarity": "cosine"},
        {"type": "filter", "path": "repo_id"},
        {"type": "filter", "path": "org_id"},
    ]}


def ensure_vector_index(coll, name: str, definition: dict) -> None:
    names = {ix["name"] for ix in coll.list_search_indexes()}
    if name in names:
        print(f"updating vector index {name}")
        coll.update_search_index(name, definition)
    else:
        print(f"creating vector index {name} ({definition['fields'][0]['numDimensions']} dims)")
        coll.create_search_index(SearchIndexModel(definition=definition, name=name, type="vectorSearch"))
    for _ in range(60):
        ix = next((i for i in coll.list_search_indexes(name)), None)
        if ix and ix.get("queryable"):
            print(f"vector index {name} READY (status={ix.get('status')})")
            return
        print(f"  waiting for {name}... status={ix and ix.get('status')}")
        time.sleep(5)
    print(f"{name} not queryable yet; check the Atlas UI")

if __name__ == "__main__":
    try:
        main()
    except OperationFailure as e:
        raise SystemExit(f"MongoDB error: {e}")
