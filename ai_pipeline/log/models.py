from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Any
import uuid
import constants as constants

@dataclass

class RequestMeta: 
    log_location: constants.logLocation
    status: str
    created_at: datetime
    last_updated: datetime
    resource_level: constants.resource_level
    debug: bool
    completed_at: Optional[datetime]=None

@dataclass
class logFileMeta:
    size: int
    created_at: datetime
    last_updated: datetime
    location: constants.logLocation
    path: Optional[str]=None

@dataclass
class EventContext:
    severity:constants.Severity
    message:str
    request_id:Optional[str]=None#null for instance logs as their file name is the request id
    context:Optional[dict[str,Any]]=None