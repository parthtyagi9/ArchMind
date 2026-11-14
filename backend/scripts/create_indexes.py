"""Create collections, JSON-schema validation, regular indexes and the Atlas Vector Search index.

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
    "required": ["memory_id", "version", "tenant_id", "memory_type", "status", "created_at", "updated_at", "expires_at"],
    "properties": {
        "tenant_id": {"bsonType": "string", "minLength": 1},
        "memory_id": {"bsonType": "string"},
        "version": {"bsonType": "int", "minimum": 1},
        "status": {"enum": ["active", "superseded", "invalidated", "purged"]},
        "memory_type": {"bsonType": "string"},
        "content": {"bsonType": "string"},
        "embedding": {"bsonType": "array"},
        "expires_at": {"bsonType": "date"},
    }}}

AUDIT_SCHEMA = {"$jsonSchema": {"bsonType": "object", "required": ["event_type", "tenant_id", "actor", "created_at"],
                                "properties": {"tenant_id": {"bsonType": "string", "minLength": 1}}}}


def vector_index_definition(dims: int) -> dict:
    return {"fields": [
        {"type": "vector", "path": "embedding", "numDimensions": dims, "similarity": "cosine"},
        {"type": "filter", "path": "tenant_id"},
        {"type": "filter", "path": "status"},
        {"type": "filter", "path": "expires_at"},
        {"type": "filter", "path": "memory_type"},
    ]}


def main() -> None:
    s = get_settings()
    db = get_db()
    existing = set(db.list_collection_names())
    for name in COLLECTIONS + ["experiments"]:
        if name not in existing:
            try:
                db.create_collection(name)
            except CollectionInvalid:
                pass
    db.command("collMod", "memories", validator=MEMORY_SCHEMA, validationLevel="moderate")
    db.command("collMod", "audit_events", validator=AUDIT_SCHEMA, validationLevel="moderate")

    db.memories.create_indexes([
        IndexModel([("tenant_id", ASCENDING), ("memory_id", ASCENDING), ("version", ASCENDING)], unique=True),
        IndexModel([("memory_id", ASCENDING)], unique=True, name="one_active_version",
                   partialFilterExpression={"status": "active"}),
        IndexModel([("tenant_id", ASCENDING), ("status", ASCENDING), ("expires_at", ASCENDING)]),
        # Optional hygiene: TTL deletes long-dead docs. Retrieval NEVER relies on it (explicit expires_at filter).
        IndexModel([("ttl_delete_at", ASCENDING)], expireAfterSeconds=0, name="ttl_cleanup"),
    ])
    db.audit_events.create_index([("tenant_id", ASCENDING), ("run_id", ASCENDING), ("created_at", ASCENDING)])
    db.audit_events.create_index([("tenant_id", ASCENDING), ("memory_id", ASCENDING)])
    db.agent_runs.create_index([("tenant_id", ASCENDING), ("incident_id", ASCENDING), ("created_at", DESCENDING)])
    db.incidents.create_index([("tenant_id", ASCENDING), ("created_at", DESCENDING)])
    db.approvals.create_index([("tenant_id", ASCENDING), ("run_id", ASCENDING)])

    definition = vector_index_definition(s.embedding_dimensions)
    names = {ix["name"]: ix for ix in db.memories.list_search_indexes()}
    if s.vector_index_name in names:
        print(f"updating vector index {s.vector_index_name}")
        db.memories.update_search_index(s.vector_index_name, definition)
    else:
        print(f"creating vector index {s.vector_index_name}")
        db.memories.create_search_index(SearchIndexModel(definition=definition, name=s.vector_index_name,
                                                         type="vectorSearch"))
    for _ in range(60):
        ix = next((i for i in db.memories.list_search_indexes(s.vector_index_name)), None)
        if ix and ix.get("queryable"):
            print(f"vector index READY (status={ix.get('status')})")
            return
        print(f"  waiting for index... status={ix and ix.get('status')}")
        time.sleep(5)
    print("index not queryable yet; check Atlas UI")


if __name__ == "__main__":
    try:
        main()
    except OperationFailure as e:
        raise SystemExit(f"MongoDB error: {e}")
