"""Byte and file-count caps for question-paper uploads.

The Next.js proxy reads the same environment variables. A blank, non-integer,
or non-positive value keeps the default so a bad setting cannot remove the cap.
"""

import os

DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024
DEFAULT_MAX_FILE_COUNT = 20
DEFAULT_MAX_REQUEST_BYTES = 200 * 1024 * 1024

FILE_BYTES_ENV = "QUESTION_PAPER_MAX_FILE_BYTES"
FILE_COUNT_ENV = "QUESTION_PAPER_MAX_FILE_COUNT"
REQUEST_BYTES_ENV = "QUESTION_PAPER_MAX_REQUEST_BYTES"


def _positive_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    text = raw.strip()
    if not text.isdigit():
        return default
    value = int(text)
    if value <= 0:
        return default
    return value


def question_paper_upload_limits() -> dict:
    return {
        "max_file_bytes": _positive_int(FILE_BYTES_ENV, DEFAULT_MAX_FILE_BYTES),
        "max_file_count": _positive_int(FILE_COUNT_ENV, DEFAULT_MAX_FILE_COUNT),
        "max_request_bytes": _positive_int(REQUEST_BYTES_ENV, DEFAULT_MAX_REQUEST_BYTES),
    }


def apply_max_content_length(app, limits=None) -> dict:
    """Cap every Flask body at the question-paper request limit."""
    resolved = limits or question_paper_upload_limits()
    app.config["MAX_CONTENT_LENGTH"] = resolved["max_request_bytes"]
    return resolved


def _rejection(message: str, status: int):
    return {"success": False, "error": message}, status


def content_length_rejection(content_length, limits=None):
    """413 when Content-Length is over the cap. None when it is absent or allowed."""
    resolved = limits or question_paper_upload_limits()
    if content_length is None:
        return None
    if content_length > resolved["max_request_bytes"]:
        return _rejection(
            f"Request is {content_length} bytes, which exceeds the "
            f"{resolved['max_request_bytes']} byte request limit",
            413,
        )
    return None


def measured_stream_size(stream) -> int:
    """Byte length via seek. The previous position is restored and read() is not used."""
    position = stream.tell()
    stream.seek(0, os.SEEK_END)
    size = stream.tell()
    stream.seek(position)
    if not isinstance(size, int) or size < 0:
        raise OSError("invalid upload size")
    return size


def stored_files_rejection(files, limits=None):
    """400 for too many files, 413 for an oversized file or combined payload.

    Stream positions are restored. File bytes are not read into a new buffer.
    """
    resolved = limits or question_paper_upload_limits()
    if len(files) > resolved["max_file_count"]:
        return _rejection(
            f"Too many files: received {len(files)}, maximum is {resolved['max_file_count']}",
            400,
        )

    total = 0
    for file in files:
        name = file.filename or "upload"
        try:
            size = measured_stream_size(file.stream)
        except (OSError, AttributeError, ValueError):
            return _rejection(f"Unable to measure the size of {name} before upload", 400)
        if size > resolved["max_file_bytes"]:
            return _rejection(
                f"File {name} is {size} bytes, which exceeds the "
                f"{resolved['max_file_bytes']} byte per-file limit",
                413,
            )
        total += size

    if total > resolved["max_request_bytes"]:
        return _rejection(
            f"Upload is {total} bytes, which exceeds the "
            f"{resolved['max_request_bytes']} byte request limit",
            413,
        )
    return None
