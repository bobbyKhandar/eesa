from enum import Enum

class JobStatus(str, Enum):
    QUEUED = "queued"#when the job is in the queue
    SCANNING = "scanning"#when the job is being scanned
    COMPLETE = "complete"#when the job has finished processing
    FAILED = "failed"#when the job has failed to process

class resource_level(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"

class Severity(Enum):
    DEBUG = "DEBUG"
    INFO = "INFO"
    WARNING = "WARNING"
    ERROR = "ERROR"
    CRITICAL = "CRITICAL"
class logLocation(Enum):
    LOCAL = "local"
    CLOUD = "cloud"


