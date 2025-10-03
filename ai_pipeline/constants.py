from enum import Enum

class JobStatus(str, Enum):
    QUEUED = "queued"#when the job is in the queue
    PENDING = "pending"#when the job is pending processing
    IN_PROGRESS = "in_progress"#when the job is being processed
    SCANNING = "scanning"#when the job is being scanned
    COMPLETE = "complete"#when the job has finished processing
    ERROR = "error"#when the job has encountered an error
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


