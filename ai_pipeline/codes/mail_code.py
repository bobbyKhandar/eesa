from enum import Enum

class statusCode(str, Enum):
    SUCCESS = "success"
    UNKNOWN_ERROR = "unknown_error"
    INVALID_REQUEST = "invalid_request"
    TIMEOUT = "timeout"
    UNKNOWN_MAIL_ERROR = "unknown_mail_error"
    MAIL_AUTHENTICATION_ERROR = "mail_authentication_error"
    MAIL_CONNECTION_ERROR="mail_connection_error"