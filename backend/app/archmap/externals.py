"""External systems and databases, recognised from facts in a file: imported libraries, host names and URL paths in
string literals, and well-known types (JavaMailSender, KafkaTemplate ...). Each match becomes one external box."""
from __future__ import annotations

import re

# id, display name, kind, regex over imports + strings + type names
CATALOG: list[tuple[str, str, str, str]] = [
    ("gemini", "Gemini API", "ai", r"generativelanguage\.googleapis\.com|google\.generativeai|google\.genai|@google/genai|@google/generative-ai|from google import genai|GenerativeModel\b|\bgemini\b"),
    ("openai", "OpenAI API", "ai", r"api\.openai\.com|\bfrom openai\b|\bimport openai\b|['\"]openai['\"]|OpenAIClient|com\.theokanning|ChatOpenAI"),
    ("anthropic", "Claude API", "ai", r"api\.anthropic\.com|\banthropic\b|@anthropic-ai/sdk|ChatAnthropic"),
    ("voyage", "Voyage AI", "ai", r"api\.voyageai\.com|\bvoyageai\b"),
    ("cohere", "Cohere API", "ai", r"api\.cohere\.|\bcohere\b"),
    ("huggingface", "Hugging Face", "ai", r"huggingface\.co|\btransformers\b|@huggingface"),
    ("wordpress", "WordPress", "cms", r"/wp-json/|wordpress"),
    ("contentful", "Contentful", "cms", r"contentful"),
    ("sanity", "Sanity CMS", "cms", r"@sanity/|sanity\.io"),
    ("rss", "RSS feeds", "feeds", r"com\.rometools|rss-parser|\bfeedparser\b|SyndFeed"),
    ("stripe", "Stripe", "payments", r"\bstripe\b|api\.stripe\.com|com\.stripe"),
    ("paypal", "PayPal", "payments", r"paypal"),
    ("razorpay", "Razorpay", "payments", r"razorpay"),
    ("sendgrid", "SendGrid", "email", r"sendgrid"),
    ("mail", "Email (SMTP)", "email", r"JavaMailSender|nodemailer|smtplib|javax\.mail|jakarta\.mail|\bresend\b|mailgun|postmark"),
    ("twilio", "Twilio", "sms", r"twilio"),
    ("s3", "Amazon S3", "storage", r"AmazonS3|S3Client|@aws-sdk/client-s3|boto3\.client\(['\"]s3|\.s3\.amazonaws\.com"),
    ("gcs", "Google Cloud Storage", "storage", r"google\.cloud\.storage|@google-cloud/storage|storage\.googleapis\.com"),
    ("cloudinary", "Cloudinary", "storage", r"cloudinary"),
    ("firebase", "Firebase", "platform", r"firebase"),
    ("supabase", "Supabase", "platform", r"supabase"),
    ("auth0", "Auth0", "auth", r"auth0"),
    ("clerk", "Clerk", "auth", r"@clerk/"),
    ("keycloak", "Keycloak", "auth", r"keycloak"),
    ("kafka", "Kafka", "messaging", r"KafkaTemplate|kafkajs|confluent_kafka|org\.apache\.kafka|aiokafka"),
    ("rabbitmq", "RabbitMQ", "messaging", r"RabbitTemplate|amqplib|\bpika\b|amqp://"),
    ("sqs", "Amazon SQS", "messaging", r"SqsClient|AmazonSQS|@aws-sdk/client-sqs|boto3\.client\(['\"]sqs"),
    ("elasticsearch", "Elasticsearch", "search", r"elasticsearch|ElasticsearchClient|@elastic/"),
    ("algolia", "Algolia", "search", r"algolia"),
    ("github", "GitHub API", "vcs", r"api\.github\.com|@octokit|\bPyGithub\b|from github import"),
    ("atlassian", "Jira / Confluence", "work", r"atlassian\.net|\bjira\b|atlassian-python-api"),
    ("slack", "Slack", "chat", r"slack_sdk|@slack/|hooks\.slack\.com"),
    ("sentry", "Sentry", "monitoring", r"sentry"),
]
DATABASES: list[tuple[str, str, str]] = [
    ("mongodb", "MongoDB", r"MongoRepository|ReactiveMongoRepository|MongoTemplate|org\.springframework\.data\.mongodb|\bpymongo\b|\bmotor\b|mongoose|['\"]mongodb['\"]|mongoengine|\bbeanie\b|MongoClient"),
    ("postgres", "PostgreSQL", r"postgres|psycopg|['\"]pg['\"]|asyncpg"),
    ("mysql", "MySQL", r"mysql"),
    ("redis", "Redis", r"RedisTemplate|ioredis|['\"]redis['\"]|\bimport redis\b|jedis|lettuce"),
    ("dynamodb", "DynamoDB", r"dynamodb|DynamoDb"),
    ("firestore", "Firestore", r"firestore"),
    ("sql", "SQL database", r"JpaRepository|jakarta\.persistence|javax\.persistence|sqlalchemy|prisma|typeorm|sequelize|knex|drizzle|sqlite|hibernate|jdbc|R2dbcRepository"),
]
KIND_VERB = {"ai": "sends prompts to", "cms": "publishes to", "feeds": "reads feeds from", "payments": "takes payments via", "email": "sends email via",
             "sms": "sends SMS via", "storage": "stores files in", "messaging": "exchanges messages via", "search": "indexes / searches in",
             "auth": "authenticates with", "vcs": "calls", "work": "calls", "chat": "posts to", "monitoring": "reports errors to", "platform": "uses"}
_IMPORT_LINE = re.compile(r"^\s*(import|from|require|using|#include|package)\b.*$|require\(['\"][^'\"]+['\"]\)", re.M)
_STRING = re.compile(r"""(['"`])((?:(?!\1)[^\n]){0,300})\1""")


def _looks_like_regex(s: str) -> bool:
    """Pattern catalogs (like this file) mention hosts inside regexes; those are not calls to the service."""
    return bool(re.search(r"\\[.bdswAZ(]|\|.*\||\(\?[:=!<]|\[\^", s))


CONNECTS = re.compile(r"MongoClient\(|AsyncIOMotorClient\(|create_engine\(|create_async_engine\(|mongoose\.connect|new PrismaClient|"
                      r"DataSource\(|new Sequelize|createPool\(|createConnection\(|psycopg2?\.connect|asyncpg\.connect|redis\.Redis\(|"
                      r"new Redis\(|DriverManager\.getConnection|sqlite3\.connect|knex\(|drizzle\(|MongoTemplate|JdbcTemplate|EntityManager")


_COMMENTS_STRINGS = re.compile(r"""//[^\n]*|#[^\n]*|/\*.*?\*/|(['"`])(?:(?!\1)[^\n\\]|\\.)*\1""", re.S)


def code_only(content: str) -> str:
    """Source with comments and string literals blanked out."""
    return _COMMENTS_STRINGS.sub(" ", content)


def connects(content: str) -> bool:
    return bool(CONNECTS.search(code_only(content)))


def evidence_text(content: str) -> str:
    """Only imports, string literals and capitalised type names: comments and prose do not create external boxes."""
    parts = [m.group(0) for m in _IMPORT_LINE.finditer(content)]
    parts += [m.group(2) for m in _STRING.finditer(content)
              if re.search(r"https?://|/wp-json/|\.com|\.io|\.net|amqp://", m.group(2)) and not _looks_like_regex(m.group(2))]
    parts += re.findall(r"\b[A-Z][A-Za-z]+(?:Template|Client|Sender|Repository|Feed|Mail\w*)\b", code_only(content))
    return "\n".join(parts)


def externals_in(content: str) -> list[tuple[str, str, str]]:
    text = evidence_text(content)
    return [(i, name, kind) for i, name, kind, rx in CATALOG if re.search(rx, text, re.I)]


def databases_in(content: str) -> list[tuple[str, str]]:
    text = evidence_text(content)
    return [(i, name) for i, name, rx in DATABASES if re.search(rx, text, re.I if i not in ("mongodb",) else 0)]
