"""
Extract text from a local PDF file using AWS Textract asynchronous API.

Usage:
    python textract_extract_text.py C:/path/to/file.pdf

Environment variables:
    S3_BUCKET   - S3 bucket used as staging for PDF upload (default: eesa-pipeline-storage)
    AWS_REGION  - Optional AWS region override
"""

import argparse
import json
import os
import sys
import time
import uuid
from pathlib import Path

import boto3


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract PDF text with AWS Textract")
    parser.add_argument("pdf_path", help="Absolute or relative path to a PDF file")
    parser.add_argument("--timeout-seconds", type=int, default=900, help="Max wait time for Textract job")
    parser.add_argument("--poll-seconds", type=int, default=5, help="Polling interval")
    return parser.parse_args()


def json_out(payload: dict, exit_code: int) -> None:
    print(json.dumps(payload, ensure_ascii=True))
    sys.exit(exit_code)


def main() -> None:
    args = parse_args()
    pdf_path = Path(args.pdf_path).expanduser().resolve()

    if not pdf_path.exists() or not pdf_path.is_file():
        json_out({"success": False, "error": f"File not found: {pdf_path}"}, 2)

    if pdf_path.suffix.lower() != ".pdf":
        json_out({"success": False, "error": "Input file must be a PDF"}, 2)

    bucket = os.getenv("S3_BUCKET", "eesa-pipeline-storage")
    region = os.getenv("AWS_REGION")

    session = boto3.session.Session(region_name=region) if region else boto3.session.Session()
    s3 = session.client("s3")
    textract = session.client("textract")

    run_id = str(uuid.uuid4())
    s3_key = f"ab_tests/{run_id}/{pdf_path.name}"

    started_at = time.time()

    try:
        s3.upload_file(str(pdf_path), bucket, s3_key, ExtraArgs={"ContentType": "application/pdf"})

        start_resp = textract.start_document_text_detection(
            DocumentLocation={"S3Object": {"Bucket": bucket, "Name": s3_key}},
            ClientRequestToken=run_id[:64],
        )
        textract_job_id = start_resp["JobId"]

        deadline = time.time() + args.timeout_seconds
        status = "IN_PROGRESS"

        while time.time() < deadline:
            status_resp = textract.get_document_text_detection(JobId=textract_job_id)
            status = status_resp.get("JobStatus", "UNKNOWN")

            if status == "SUCCEEDED":
                break

            if status == "FAILED":
                message = status_resp.get("StatusMessage", "Textract job failed")
                json_out(
                    {
                        "success": False,
                        "error": message,
                        "textract_job_id": textract_job_id,
                        "s3_bucket": bucket,
                        "s3_key": s3_key,
                    },
                    3,
                )

            time.sleep(max(1, args.poll_seconds))

        if status != "SUCCEEDED":
            json_out(
                {
                    "success": False,
                    "error": "Timed out waiting for Textract job",
                    "textract_job_id": textract_job_id,
                    "s3_bucket": bucket,
                    "s3_key": s3_key,
                },
                4,
            )

        lines = []
        page_count = 0

        next_token = None
        while True:
            if next_token:
                resp = textract.get_document_text_detection(JobId=textract_job_id, NextToken=next_token)
            else:
                resp = textract.get_document_text_detection(JobId=textract_job_id)

            for block in resp.get("Blocks", []):
                block_type = block.get("BlockType")
                if block_type == "LINE":
                    text = block.get("Text", "")
                    if text:
                        lines.append(text)
                elif block_type == "PAGE":
                    page_count += 1

            next_token = resp.get("NextToken")
            if not next_token:
                break

        extracted_text = "\n".join(lines)
        elapsed_ms = int((time.time() - started_at) * 1000)

        json_out(
            {
                "success": True,
                "text": extracted_text,
                "line_count": len(lines),
                "page_count": page_count,
                "textract_job_id": textract_job_id,
                "s3_bucket": bucket,
                "s3_key": s3_key,
                "elapsed_ms": elapsed_ms,
            },
            0,
        )

    except Exception as exc:
        json_out(
            {
                "success": False,
                "error": str(exc),
                "s3_bucket": bucket,
                "s3_key": s3_key,
            },
            5,
        )


if __name__ == "__main__":
    main()
