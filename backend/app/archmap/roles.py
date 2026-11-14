"""Role rules: what each symbol IS in the architecture (screen, API client, endpoint, service, repository, entity ...).

Rules are data, checked in order: framework annotations/decorators, base types, module facts (routes in the file, JSX,
HTTP calls), then naming conventions and folder names as the generic fallback. Adding a framework is adding rows here."""
from __future__ import annotations

import re

from app.archmap.parse import Symbol

# Role -> (layer for top-to-bottom ordering, shown as a box by default)
ROLES: dict[str, tuple[int, bool]] = {
    "actor": (0, True),
    "router": (1, True),       # UI route table / app shell
    "page": (2, True),         # routed screen
    "component": (3, False),   # shared UI widget (shown only when it talks to an API client)
    "client": (4, True),       # frontend API client
    "endpoint": (5, True),     # HTTP controller / route module
    "job": (5, True),          # scheduled job / consumer
    "service": (6, True),      # business logic
    "mapper": (7, True),
    "repository": (8, True),   # DAO
    "entity": (9, True),       # persisted record
    "external": (10, True),
    "database": (10, True),
    "dto": (7, False),         # shown as tags on the boxes that use them
    "model": (7, False),       # frontend types
    "config": (11, False),
    "middleware": (11, False),
    "util": (11, False),
    "other": (11, False),
}
VISIBLE = {r for r, (_, v) in ROLES.items() if v}
LAYER = {r: lr for r, (lr, _) in ROLES.items()}

ANNOTATION_ROLES = [
    ({"RestController", "Controller", "Path", "RequestMapping"}, "endpoint"),
    ({"RestControllerAdvice", "ControllerAdvice", "Configuration", "ConfigurationProperties", "SpringBootApplication",
      "EnableWebSecurity", "NgModule", "Module", "EnableScheduling"}, "config"),
    ({"Repository", "Dao", "EntityRepository"}, "repository"),
    ({"Entity", "Document", "Table", "Embeddable", "MappedSuperclass", "Schema", "Node", "RedisHash"}, "entity"),
    ({"Mapper"}, "mapper"),
    ({"Service", "UseCase", "Transactional"}, "service"),
]
JOB_METHOD_ANNOTATIONS = {"Scheduled", "KafkaListener", "RabbitListener", "SqsListener", "JmsListener", "EventListener", "Cron", "Interval",
                          "shared_task", "task", "scheduled_job", "periodic_task", "Process", "OnEvent", "MessagePattern", "EventPattern"}
BASE_ROLES = [
    ({"JpaRepository", "CrudRepository", "MongoRepository", "PagingAndSortingRepository", "ReactiveMongoRepository",
      "ReactiveCrudRepository", "R2dbcRepository", "ListCrudRepository", "CoroutineCrudRepository", "Repository"}, "repository"),
    ({"BaseModel", "TypedDict", "NamedTuple", "Schema", "Serializer"}, "dto"),
    ({"Model", "DeclarativeBase", "SQLModel", "Document", "DynamicDocument", "EmbeddedDocument"}, "entity"),
    ({"APIView", "ViewSet", "ModelViewSet", "GenericAPIView", "View", "Resource", "MethodView", "TemplateView", "ListView", "DetailView"}, "endpoint"),
    ({"Exception", "RuntimeException", "Error", "HttpException"}, "other"),
    ({"Task", "Job", "Thread", "Runnable", "Consumer"}, "job"),
]
SUFFIX_ROLES = [
    (r"(Controller|Resource|Endpoint|Endpoints|Handler|Router|Routes|Views?|RestApi)$", "endpoint"),
    (r"(Repository|Repo|Dao|DAO)$", "repository"),
    (r"(Dto|DTO|Request|Response|Payload|Command|Params|Input|Output|Form|Vo|VO)$", "dto"),
    (r"(Mapper|Converter|Assembler|Transformer)$", "mapper"),
    (r"(Scheduler|Job|Jobs|Task|Tasks|Worker|Cron|Consumer|Listener|Subscriber)$", "job"),
    (r"(Config|Configuration|Properties|Settings|Module|Application|Initializer|Bootstrap)$", "config"),
    (r"(Exception|Error|Errors)$", "other"),
    (r"(Util|Utils|Helper|Helpers|Constants|Const)$", "util"),
    (r"(Interceptor|Filter|Middleware|Guard|Advice|Aspect)$", "middleware"),
    (r"(Service|Manager|UseCase|Interactor|Facade|Processor|Engine|Orchestrator|Client|Gateway|Adapter|Connector|Publisher|Provider)$", "service"),
    (r"(Entity|Model|Record)$", "entity"),
]
FOLDER_ROLES = [
    (r"(^|/)(controllers?|routes?|routers?|handlers?|endpoints?|resources?|views?)(/|$)", "endpoint"),
    (r"(^|/)(repositor(y|ies)|daos?|persistence)(/|$)", "repository"),
    (r"(^|/)(dtos?|requests?|responses?|payloads?|schemas?)(/|$)", "dto"),
    (r"(^|/)(mappers?|converters?|assemblers?)(/|$)", "mapper"),
    (r"(^|/)(jobs?|schedulers?|tasks?|workers?|cron|consumers?|listeners?)(/|$)", "job"),
    (r"(^|/)(models?|entities|entity|domain)(/|$)", "entity"),
    (r"(^|/)(config|configs|configuration|settings)(/|$)", "config"),
    (r"(^|/)(utils?|helpers?|common|shared|hooks?)(/|$)", "util"),
    (r"(^|/)(services?|usecases?|application|core|logic|business)(/|$)", "service"),
]
FRONTEND_FOLDER_ROLES = [
    (r"(^|/)(pages?|screens?|views?|routes?)(/|$)", "page"),
    (r"(^|/)(components?|widgets?|ui|shared)(/|$)", "component"),
    (r"(^|/)(services?|api|apis|clients?|lib|data)(/|$)", "client"),
    (r"(^|/)(models?|types?|interfaces?)(/|$)", "model"),
    (r"(^|/)(environments?|config)(/|$)", "config"),
]
HTTP_CLIENT_TYPES = {"HttpClient", "AxiosInstance", "Axios", "HttpService", "RestTemplate", "WebClient", "HTTPClient", "Session", "AsyncClient", "Client"}


def classify(sym: Symbol, *, frontend: bool, routed: bool, has_routes: bool, makes_http_calls: bool, is_route_table: bool) -> str:
    """routed: a UI route table points at this symbol; has_routes: the symbol serves HTTP routes;
    makes_http_calls: HTTP calls were found inside it; is_route_table: a module that maps URLs to screens."""
    path = sym.file.lower()
    name = sym.name.split("/")[-1]
    anns = set(sym.annotations)
    bases = set(sym.bases)

    if is_route_table:
        return "router"
    if frontend:
        if sym.kind in ("interface", "enum"):
            return "model"
        if bases & {"Error", "Exception"} or re.search(r"(Error|Exception)$", name):
            return "other"
        if "Component" in anns or sym.jsx or re.search(r"(^|/)app/.*page\.(tsx|jsx|js)$|(^|/)pages/", path):
            if routed or re.search(r"(^|/)app/(.*/)?page\.(tsx|jsx|js)$|(^|/)pages/(?!api/)", path) or re.search(r"(Page|Screen|View)$", name):
                return "page"
            return "component"
        if makes_http_calls or HTTP_CLIENT_TYPES & set(sym.deps.values()):
            return "client"
        if "Injectable" in anns:
            return "service"
        for rx, role in FRONTEND_FOLDER_ROLES:
            if re.search(rx, path):
                return "util" if role == "client" else role  # a client is only a client if it makes HTTP calls (checked above)
        return "util" if sym.kind == "module" else "service"

    # ---- backend
    if sym.kind == "enum":
        return "dto"
    if re.search(r"(^|/)(scripts?|migrations?|alembic|tools|bin|fixtures|seeds?|examples?|docs?)(/|$)", path):
        return "util"
    if "dataclass" in anns or "dataclass" in " ".join(sym.annotation_text) or (sym.lang == "python" and sym.kind == "class"
                                                                             and not [m for m in sym.methods if not m.startswith("__")]):
        return "dto"
    method_anns = set(sym.method_annotations)
    if has_routes:
        return "endpoint"
    for names, role in ANNOTATION_ROLES:
        if anns & names:
            if role == "service" and method_anns & JOB_METHOD_ANNOTATIONS:
                return "job"
            if role == "endpoint" and "RequestMapping" in anns and not anns & {"RestController", "Controller", "Path"} and sym.kind == "interface":
                return "client"  # Feign-style declarative client
            return role
    if method_anns & JOB_METHOD_ANNOTATIONS or anns & {"shared_task", "task", "periodic_task"}:
        return "job"
    if "Component" in anns and "Injectable" not in anns:
        pass  # plain Spring @Component: fall through to naming
    if "Injectable" in anns:
        return "service"
    for names, role in BASE_ROLES:
        if bases & names:
            return role
    for rx, role in SUFFIX_ROLES:
        if re.search(rx, name if sym.kind != "module" else name.title().replace("_", "")):
            return role
    for rx, role in FOLDER_ROLES:
        if re.search(rx, path):
            return role
    if sym.kind == "interface":
        return "other"
    if sym.kind == "module":
        return "util"
    return "service" if len([t for t in sym.deps.values() if t[:1].isupper()]) >= 1 and sym.calls else "other"
