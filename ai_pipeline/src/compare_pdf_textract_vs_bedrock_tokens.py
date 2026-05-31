"""
Minimal A/B token test for PDF processing.

Branch A (direct): local PDF -> Bedrock Parse -> Bedrock Enrich
Branch B (textract): local PDF -> S3 -> Textract OCR -> Bedrock Parse -> Bedrock Enrich

This script does not save structured output.
It only prints phase-wise and total token usage.
"""

from __future__ import annotations

import base64
import json
import os
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import boto3
from botocore.exceptions import ClientError

try:
    import fitz  # PyMuPDF
except ImportError:
    fitz = None

def _load_env_file(path: Path) -> None:
    if not path.exists() or not path.is_file():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def _bootstrap_env() -> None:
    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parent.parent
    _load_env_file(repo_root / ".env")
    _load_env_file(repo_root / "backend" / ".env")
    _load_env_file(repo_root / "ai_pipeline" / ".env")

    # Support lower-case credential env vars used in some project scripts.
    if "AWS_ACCESS_KEY_ID" not in os.environ and os.getenv("awsaccessKeyId"):
        os.environ["AWS_ACCESS_KEY_ID"] = os.environ["awsaccessKeyId"]
    if "AWS_SECRET_ACCESS_KEY" not in os.environ and os.getenv("awssecretAccessKey"):
        os.environ["AWS_SECRET_ACCESS_KEY"] = os.environ["awssecretAccessKey"]
    if "AWS_SESSION_TOKEN" not in os.environ and os.getenv("awsSessionToken"):
        os.environ["AWS_SESSION_TOKEN"] = os.environ["awsSessionToken"]


_bootstrap_env()

_FORCE_NO_SESSION_TOKEN = False
_FORCE_DEFAULT_CHAIN = False


AWS_REGION = os.getenv("AWS_REGION", "ap-south-1")
BEDROCK_MODEL_ID = os.getenv("BEDROCK_MODEL_ID", "google.gemma-3-27b-it")


PARSING_SYSTEM_INSTRUCTIONS = """
You are an expert parsing AI. Your sole task is to convert a messy text blob containing one or more exam papers into a single, clean JSON structure.

CRITICAL OUTPUT REQUIREMENTS:
1. LANGUAGE: Entire response must be English only.
2. FORMAT: Entire response must be only a single valid JSON object.
3. NO NESTING: The questions array must be a flat list.

CONTINUATION DETECTION:
If text appears mid-document, return is_continuation=true.

PARSING RULES:
1. Split multiple exams under exams.
2. Extract metadata: subject, max_marks, year, semester, branch, examType.
3. Extract questions with question_number, question_text, marks, questionType, options.
4. Handle OR blocks as distinct question objects.
5. Missing metadata/marks should be empty string.

Output JSON shape:
{
    "is_continuation": false,
    "starts_at_question": null,
    "exams": [
        {
            "subject": "...",
            "max_marks": "...",
            "year": "...",
            "semester": "...",
            "branch": "...",
            "examType": "main",
            "questions": [
                {
                    "question_number": "Q1 (a)",
                    "question_text": "...",
                    "questionType": "text",
                    "marks": "10"
                }
            ]
        }
    ],
    "subjectsCreated": ["..."]
}

If input is too big, output exactly: too big text
""".strip()


class TokenUsageError(RuntimeError):
    pass


def _client(service_name: str):
    global _FORCE_DEFAULT_CHAIN
    kwargs = {"region_name": AWS_REGION}

    access_key = os.getenv("AWS_ACCESS_KEY_ID")
    secret_key = os.getenv("AWS_SECRET_ACCESS_KEY")
    session_token = os.getenv("AWS_SESSION_TOKEN")

    if access_key and secret_key and not _FORCE_DEFAULT_CHAIN:
        kwargs["aws_access_key_id"] = access_key
        kwargs["aws_secret_access_key"] = secret_key
        if session_token and not _FORCE_NO_SESSION_TOKEN:
            kwargs["aws_session_token"] = session_token

    return boto3.client(service_name, **kwargs)


def _validate_aws_auth() -> None:
    global _FORCE_NO_SESSION_TOKEN, _FORCE_DEFAULT_CHAIN
    sts = _client("sts")
    try:
        identity = sts.get_caller_identity()
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        # Common case: stale AWS_SESSION_TOKEN with long-lived access keys.
        if code in {"InvalidClientTokenId", "UnrecognizedClientException"} and os.getenv("AWS_SESSION_TOKEN"):
            _FORCE_NO_SESSION_TOKEN = True
            try:
                identity = _client("sts").get_caller_identity()
            except ClientError as retry_exc:
                # Fall through to default chain fallback below.
                code2 = retry_exc.response.get("Error", {}).get("Code", "")
                if code2 not in {"InvalidClientTokenId", "UnrecognizedClientException"}:
                    raise RuntimeError(
                        "AWS auth failed after retry without AWS_SESSION_TOKEN. "
                        f"Underlying error: {retry_exc}"
                    ) from retry_exc
                _FORCE_DEFAULT_CHAIN = True
                try:
                    identity = _client("sts").get_caller_identity()
                except ClientError as retry_chain_exc:
                    raise RuntimeError(
                        "AWS auth failed with all credential modes: env token, env no-token, and default chain/profile. "
                        "Fix credentials in .env or configure AWS CLI profile. "
                        f"Underlying error: {retry_chain_exc}"
                    ) from retry_chain_exc
        else:
            # If env keys are invalid, try default chain/profile as fallback.
            _FORCE_DEFAULT_CHAIN = True
            try:
                identity = _client("sts").get_caller_identity()
            except ClientError as retry_chain_exc:
                raise RuntimeError(
                    "AWS auth failed. Tried env credentials and default chain/profile. "
                    "Check AWS keys in .env or run AWS CLI configure/profile. "
                    f"Underlying error: {retry_chain_exc}"
                ) from retry_chain_exc

    account = identity.get("Account", "unknown")
    arn = identity.get("Arn", "unknown")
    if _FORCE_NO_SESSION_TOKEN:
        print("AWS auth fallback applied: ignored AWS_SESSION_TOKEN and used access key + secret key.")
    if _FORCE_DEFAULT_CHAIN:
        print("AWS auth fallback applied: ignored env credential pair and used default AWS credential chain/profile.")
    print(f"Using AWS identity: {arn} (account {account})")


def _extract_pdf_text(pdf_path: Path) -> str:
    if not fitz:
        raise RuntimeError("PyMuPDF required. Install: pip install PyMuPDF")

    doc = fitz.open(str(pdf_path))
    try:
        page_texts: List[str] = []
        for page in doc:
            page_texts.append(page.get_text("text"))
        return "\n\n".join(text.strip() for text in page_texts if text and text.strip())
    finally:
        doc.close()


def _pdf_to_base64_images(pdf_path: Path) -> List[str]:
    """Convert PDF pages to base64-encoded PNG images."""
    if not fitz:
        raise RuntimeError("PyMuPDF required. Install: pip install PyMuPDF")
    if not pdf_path.exists() or not pdf_path.is_file():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")
    if pdf_path.suffix.lower() != ".pdf":
        raise ValueError("Input file must be a PDF")
    
    doc = fitz.open(str(pdf_path))
    base64_images = []
    for page_num in range(len(doc)):
        page = doc[page_num]
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        png_bytes = pix.tobytes("png")
        b64 = base64.b64encode(png_bytes).decode("utf-8")
        base64_images.append(b64)
    doc.close()
    return base64_images




def _extract_usage(response: Dict) -> Tuple[int, int]:
    usage = response.get("usage") or {}
    input_tokens = usage.get("inputTokens") or usage.get("input_tokens")
    output_tokens = usage.get("outputTokens") or usage.get("output_tokens")
    if input_tokens is None or output_tokens is None:
        raise TokenUsageError(f"Missing token usage in Bedrock response: {json.dumps(response, default=str)[:500]}")
    return int(input_tokens), int(output_tokens)


def _bedrock_text_from_response(response: Dict) -> str:
    message = response.get("output", {}).get("message", {})
    parts = message.get("content", [])
    text_parts: List[str] = []
    for part in parts:
        if isinstance(part, dict) and part.get("text"):
            text_parts.append(part["text"])
    return "".join(text_parts).strip()


def _extract_json_object(text: str) -> Dict:
    cleaned = text.replace("```json", "").replace("```", "").strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or start > end:
        raise ValueError("No JSON object found in model response")
    return json.loads(cleaned[start : end + 1])


def _build_enrichment_prompt(questions: List[Dict], subject: str, semester: str, branch: str) -> str:
    questions_text = ""
    for idx, q in enumerate(questions):
        questions_text += f"\n{idx + 1}. {q.get('question_number', 'N/A')} ({q.get('marks', '?')} marks)\n"
        questions_text += f"   Type: {q.get('questionType', 'text')}\n"
        questions_text += f"   Text: {q.get('question_text', '')}\n"
        options = q.get("options")
        if isinstance(options, list) and options:
            questions_text += f"   Options: {', '.join(options[:2])}...\n"

    return f"""Analyze these exam questions and classify each using Bloom's Taxonomy.

Subject: {subject}
Semester: {semester}
Branch: {branch}

Questions:
{questions_text}

Bloom levels: Recall, Understand, Apply, Analyze, Evaluate, Create.

For each question provide:
- bloomLevel
- bloomJustification
- confidence
- difficulty
- keywords
- topicsCovered

Return ONLY JSON array in question order:
[
  {{
    "questionIndex": 0,
    "bloomLevel": "Apply",
    "bloomJustification": "...",
    "confidence": 0.88,
    "difficulty": "Medium",
    "keywords": ["..."],
    "topicsCovered": ["..."]
  }}
]

CRITICAL: Return ONLY JSON array.""".strip()


def _bedrock_call(content: List[Dict], *, system_text: Optional[str] = None, max_tokens: int = 8192) -> Tuple[str, int, int]:
    bedrock = _client("bedrock-runtime")
    request: Dict = {
        "modelId": BEDROCK_MODEL_ID,
        "messages": [{"role": "user", "content": content}],
        "inferenceConfig": {
            "maxTokens": max_tokens,
            "temperature": 0.1,
            "topP": 0.9,
        },
    }
    if system_text:
        request["system"] = [{"text": system_text}]

    response = bedrock.converse(**request)
    in_toks, out_toks = _extract_usage(response)
    return _bedrock_text_from_response(response), in_toks, out_toks


def _parse_phase_from_pdf(pdf_path: Path) -> Tuple[Dict, int, int]:
    base64_images = _pdf_to_base64_images(pdf_path)
    if not base64_images:
        raise RuntimeError("No pages found in PDF")

    image_content: List[Dict] = []
    for b64 in base64_images:
        image_content.append(
            {
                "image": {
                    "format": "png",
                    "source": {"bytes": base64.b64decode(b64)},
                }
            }
        )

    image_content.append({"text": "Parse this exam document into the required JSON format."})

    parse_text, in_toks, out_toks = _bedrock_call(
        image_content,
        system_text=PARSING_SYSTEM_INSTRUCTIONS,
    )
    if "too big text" in parse_text.lower():
        raise RuntimeError("Parse phase returned too big text")
    return _extract_json_object(parse_text), in_toks, out_toks


def _parse_phase_from_text(extracted_text: str) -> Tuple[Dict, int, int]:
    parse_text, in_toks, out_toks = _bedrock_call(
        [{"text": extracted_text}],
        system_text=PARSING_SYSTEM_INSTRUCTIONS,
    )
    if "too big text" in parse_text.lower():
        raise RuntimeError("Parse phase returned too big text")
    return _extract_json_object(parse_text), in_toks, out_toks


def _textract_text_from_images(pdf_path: Path) -> str:
    textract = _client("textract")
    lines: List[str] = []
    for b64 in _pdf_to_base64_images(pdf_path):
        png_bytes = base64.b64decode(b64)
        response = textract.detect_document_text(Document={"Bytes": png_bytes})
        for block in response.get("Blocks", []):
            if block.get("BlockType") == "LINE" and block.get("Text"):
                lines.append(block["Text"])
    return "\n".join(lines)


def _enrich_phase(parsed_json: Dict) -> Tuple[int, int, int]:
    total_in = 0
    total_out = 0
    exam_calls = 0

    exams = parsed_json.get("exams") or []
    for exam in exams:
        questions = exam.get("questions") or []
        if not questions:
            continue

        prompt = _build_enrichment_prompt(
            questions=questions,
            subject=exam.get("subject", "Unknown"),
            semester=exam.get("semester", "N/A"),
            branch=exam.get("branch", "N/A"),
        )

        _, in_toks, out_toks = _bedrock_call(
            [{"text": prompt}],
            max_tokens=8192,
        )
        total_in += in_toks
        total_out += out_toks
        exam_calls += 1

    return total_in, total_out, exam_calls


def run_direct_pipeline(pdf_path: Path) -> Dict:
    parsed, parse_in, parse_out = _parse_phase_from_pdf(pdf_path)
    enrich_in, enrich_out, enrich_calls = _enrich_phase(parsed)

    total_in = parse_in + enrich_in
    total_out = parse_out + enrich_out
    return {
        "parse_phase": {
            "input_tokens": parse_in,
            "output_tokens": parse_out,
        },
        "enrich_phase": {
            "calls": enrich_calls,
            "input_tokens": enrich_in,
            "output_tokens": enrich_out,
        },
        "total": {
            "input_tokens": total_in,
            "output_tokens": total_out,
        },
    }


def run_textract_pipeline(pdf_path: Path) -> Dict:
    extracted_text = _textract_text_from_images(pdf_path)

    if not extracted_text.strip():
        raise RuntimeError("Textract returned empty text")

    parsed, parse_in, parse_out = _parse_phase_from_text(extracted_text)
    enrich_in, enrich_out, enrich_calls = _enrich_phase(parsed)

    total_in = parse_in + enrich_in
    total_out = parse_out + enrich_out
    return {
        "textract_phase": {
            "text_chars": len(extracted_text),
        },
        "parse_phase": {
            "input_tokens": parse_in,
            "output_tokens": parse_out,
        },
        "enrich_phase": {
            "calls": enrich_calls,
            "input_tokens": enrich_in,
            "output_tokens": enrich_out,
        },
        "total": {
            "input_tokens": total_in,
            "output_tokens": total_out,
        },
    }


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python compare_pdf_textract_vs_bedrock_tokens.py <pdf_path>")
        return 1

    pdf_path = Path(sys.argv[1]).expanduser().resolve()

    _validate_aws_auth()

    direct = run_direct_pipeline(pdf_path)
    textract = run_textract_pipeline(pdf_path)

    print(
        json.dumps(
            {
                "direct_pdf_pipeline": direct,
                "textract_pipeline": textract,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
