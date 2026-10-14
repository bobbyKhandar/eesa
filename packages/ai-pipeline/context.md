# AI Pipeline Domain Rules — Python/Flask

## Framework & Setup
- **Framework:** Flask (Python 3.10+). No blueprints — routes are registered directly on the `app` object.
- **Dependencies:** Listed in `requirements-ocr.txt`. Key packages: `opencv-python`, `easyocr`, `pdf2image`, `PyMuPDF`, `Pillow`, `numpy`, `redis`, `lancedb`, `hdbscan`, `pyarrow`, `boto3`.
- **CORS:** `flask-cors` — all servers enable `CORS(app)`. CORS does not authenticate callers.
- **Service auth:** Every route except `GET /health` requires `Authorization: Bearer $AI_PIPELINE_TOKEN` and a loopback (or `AI_PIPELINE_TRUSTED_HOSTS`) address. User and role checks stay in the Next.js helpers (`jobContentAccessDecision`, upload-session ownership, `requireAdminCaller`). The production listener binds to `127.0.0.1` unless `AI_PIPELINE_ALLOW_PUBLIC_BIND=1`.
- **Question-paper upload limits:** `POST /upload/question-papers` reads `QUESTION_PAPER_MAX_FILE_BYTES` (default 25 MB), `QUESTION_PAPER_MAX_FILE_COUNT` (default 20), and `QUESTION_PAPER_MAX_REQUEST_BYTES` (default 200 MB). `register_routes` sets Flask `MAX_CONTENT_LENGTH` to that request cap, so every route rejects a larger body with 413. The upload route returns 413 for an oversized file or body and 400 for too many files before it stores anything. Accepted PDFs are streamed to S3 with `upload_fileobj`. A non-PDF in an otherwise valid batch is still reported as an error and is not stored.

## Server Entry Point

### `src/api/server.py` — Canonical Server
- Module-level `app = Flask(__name__)` + `CORS(app)` — serves as the WSGI entry point.
- All routes registered via decorators at import time (for Gunicorn/WSGI compatibility).
- `AIServer` class wraps the module-level `app` for non-blocking thread lifecycle (`start_server()` / `stop_server()`).
- **Threading:** `ThreadPoolExecutor(max_workers=3)` with lazy double-checked init for background AWS jobs.
- **Job persistence:** S3-backed metadata with in-memory LRU cache (100-job limit with eviction).
- **Startup:** `python src/api/server.py` (blocking), `start_server()` (non-blocking), or via `wsgi.py` (Gunicorn).
- **Used by:** `wsgi.py` (production), `start_server.py` (development), `src/server.py` (bootstrap re-exporter).
- **Routes:** `/health` (no credential), and authenticated `/process`, `/process/batch`, `/job/<id>/status`, `/job/<id>/metadata`, `/job/<id>/questions`, `/job/<id>/retry`, `/jobs/active`, `/submit-local`, `/submit` (legacy), `/submit-aws`, `/status-aws/<job_id>`, `/status/<batch_id>`, `/result/<batch_id>`, `/upload/question-papers`. `POST /job/<id>/retry` re-queues a `failed` or `partial_success` job from its original S3 PDF and marks the metadata `in_progress` before the worker starts.
- **Listener:** `AIServer` and `gunicorn.conf.py` bind to loopback. `AI_PIPELINE_ALLOW_REMOTE=1` allows non-local clients that still present the token.

> Note: Root `server.py` is a deprecated backward-compat shim. Do not use for new code.

## Pipeline Modes

### AWS Pipeline (Production)
- **Stages:** Textract OCR -> Bedrock Parsing -> Bedrock Enrichment -> S3 Organization -> Question Clustering.
- **Orchestrator:** `AWSPipelineManager` in `src/api/aws_manager.py`.
- **S3 structure per job:**
  ```
  jobs/{job_id}/original/{filename}                      # Uploaded PDF
  jobs/{job_id}/ocr_output/{filename}_ocr.json           # Textract output
  jobs/{job_id}/parsed_output/{filename}_parsed.json     # Bedrock parsing
  jobs/{job_id}/enriched_output/{filename}_enriched.json # Bedrock enrichment
  jobs/{job_id}/organized_output/                        # Organized by subject
  jobs/{job_id}/metadata.json                            # Job metadata
  ```
- **Threading per job:** `ThreadPoolExecutor(max_workers=3)` with lazy double-checked init.

### Local Pipeline (Development/Testing)
- **Engine:** EasyOCR via `OCREngine` class (`src/local_ocr_engine.py`).
- **OCR sanitization:** `OCREngine.sanitize_text` keeps mathematical and scientific symbols (`+ = / * < > ^ % [ ] { }`, Unicode math such as `× ÷ ≤ ≥ ≠ √`, Greek letters, and the degree sign) and still strips control characters and other junk.
- **Image processing:** `ImageProcessor` class (`src/local_image_processor_pipeline.py`).
- **PDF handling:** `PDFHandler` (`src/pdf_handler.py`) renders with PyMuPDF. `iter_pages` yields one page image at a time. The local batch path calls `validate_pdf` first, OCRs that page, then drops the image before the next page is rendered. `extract_pages` still returns a list for existing callers. `MAX_PAGES_PER_PDF` (default 1000) and `MAX_PDF_PAGE_PIXELS` (default 50,000,000) are hard failures checked before a pixmap is built. `DEFAULT_DPI` (default 400) is the render resolution those pixel checks and the batch path use. A blank or non-positive value keeps the default. A file over 100MB still only warns.
- **DOCX handling:** `should_extract_docx` / `extract_docx_result` in `src/docx_handler.py`. A batch file whose `options.file_type` is `docx`, or whose path ends in `.docx`, is read from `word/document.xml`. It is not sent through `PDFHandler`. PDF and image uploads stay on the OCR path. Legacy `.doc` files fail with an error asking for `.docx`.
- **Queue management:** Redis via `redis_client.py` — required for local pipeline. Connection: `redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)`.
- **Pipeline manager:** `PipelineManager` singleton (`src/pipeline_manager.py`) — uses background thread for continuous batch processing. `_process_single_batch` branches to `_process_docx_file` before `_process_pdf_file`. PDF page outcomes are compiled by `compile_pdf_file_result` (`src/ocr_file_result.py`). A file is `status: success` only when every page succeeds. Dropped pages set `status: partial`, `success: false`, and `failed_pages` / `failed_page_numbers`, and the batch status is `partial` (not `completed`). If every page fails, the file and batch are `failed`. The file payload is still stored so callers can see which pages were lost. This local batch status is separate from the AWS job status `partial_success`. DOCX extraction is unchanged.

## Module Architecture

### Core Pipeline Modules
| Module | Role |
|---|---|
| `src/aws_texttract_pipeline.py` | Async Textract OCR via `start_document_text_detection()` + polling |
| `src/parsing_pipeline.py` | Bedrock parsing with Gemma 3 27B — extracts Q&A from OCR text. Chunked parsing lists `failed_chunks` and sets `status` to `success`, `partial`, or `failed` |
| `src/enrich_questions_job_based.py` | Bedrock enrichment — Bloom's taxonomy, difficulty, keywords, syllabus. Chunked enrichment reads `chunk_metadata` and keeps continuation markers for the merger |
| `src/organize_by_subject_job_based.py` | Groups enriched questions into subject-organized JSON on S3 |
| `src/intelligent_chunking.py` | Splits large OCR text (20k+ chars) at question boundaries. If no boundary exists, or one section exceeds `max_chars_per_chunk`, falls back to paragraph, then line, then hard character splits so every chunk stays within the maximum. Continuation pieces set `is_continuation` |
| `src/chunk_merger.py` | Validates and merges chunked parsing results. `build_enriched_chunk` copies parsing's `chunk_metadata` — including `is_continuation` and `starts_at_question` — onto each enriched chunk so an exam that crosses a chunk boundary stays one exam |
| `src/question_clustering.py` | LanceDB vector store + FAISS/HDBSCAN for similarity clustering and appearance frequency. LanceDB ids are `{job}::{organized source key}::{exam id or index}::{question id or number}`, and similarity is written back to that question. Each organized file write-back is a `file_updates` outcome. `status` is `success` only when every expected file is updated, `partial` when some fail, and `failed` when none are updated. `failed_keys` lists the files that were not updated |
| `src/local_ocr_engine.py` | EasyOCR-based OCR engine with GPU auto-detect |
| `src/local_image_processor_pipeline.py` | Image preprocessing (denoise, sharpen, binarize, deskew, contrast enhancement) |
| `src/pdf_handler.py` | Incremental PDF page rendering via PyMuPDF, with page-count and pixel limits |
| `src/docx_handler.py` | Direct DOCX text extraction from Office Open XML (no OCR) |
| `src/pipeline_manager.py` | Redis-backed local pipeline manager (singleton). DOCX uploads bypass the PDF handler |
| `src/pipeline_orchestrator.py` | Orchestration layer — upload, process, download, save workflow |

### API Module (`src/api/`)
| File | Role |
|---|---|
| `__init__.py` | Exports `create_app`, `start_server`, `stop_server`, `AWSPipelineManager` |
| `server.py` | Module-level Flask app with CORS, route registration, `AIServer` class for thread lifecycle |
| `routes.py` | Route definitions via `register_routes()` function — 15 routes covering production + legacy paths |
| `job_retry.py` | Decides whether a failed job can be re-queued from its stored PDF |
| `aws_manager.py` | `AWSPipelineManager` — full 5-stage pipeline orchestration, S3 metadata persistence, bounded thread pool |
| `question_retriever.py` | Question retrieval with 3-level S3 fallback (organized → enriched → parsed), Bloom's taxonomy stats |

### Supporting Modules
| File | Role |
|---|---|
| `src/enrich_questions_s3_pipeline.py` | Standalone S3-based enrichment with `ThreadPoolExecutor(20)`. `processed` and the enriched object key use a source identity (input-relative path plus a short hash of the input directory). Legacy basename entries do not skip a file unless `source_namespace` pins that state to the current directory |
| `src/organize_by_subject.py` | Local filesystem-based subject organization |
| `src/manual_pipeline.py` | CLI pipeline (upload → OCR → parse → enrich → organize) with SQLite tracking. Enrichment accepts a batch only when every question has a valid Bloom level, difficulty, `keywords` list, and `topicsCovered` list. An incomplete batch is retried up to 3 times, then the job fails instead of advancing to organize |
| `src/redis_client.py` | Redis queue/hash operations for local pipeline job management |
| `src/redisMaster.py` | Documentation of Redis data structure design |
| `src/reprocess_errors.py` | Error reprocessing for Bedrock parsing/enrichment failures |
| `constants.py` | Enums: `JobStatus`, `resource_level`, `Severity`, `logLocation` |
| `imagePreprocess.py` | Legacy multiprocessing pipeline (do not extend) |

## AWS Integration
- **Services:** `s3`, `textract`, `bedrock-runtime`.
- **boto3 clients:** Created per-module with `boto3.client('service', region_name='ap-south-1')`. Standard credential chain (env vars, `~/.aws/credentials`, IAM role).
- **Bedrock models:** `google.gemma-3-27b-it` (parsing, enrichment), `amazon.titan-embed-text-v2:0` (embeddings for clustering).
- **Config:** `read_timeout=300`, `connect_timeout=60`, retries `adaptive`.
- **S3 bucket:** `eesa-pipeline-storage` (from env `S3_BUCKET` or default). `POST /process` and `POST /process/batch` read the source PDF from the request `s3_bucket` when one is given, after `/process` has verified that object with `head_object`. A missing or blank `s3_bucket` uses the configured bucket. `process_aws_job_pipeline` takes that bucket and passes it to Textract. Later stage output still lands in the configured bucket.
- **Region:** `ap-south-1` from `.env` var `aws_location`.

## Testing
- **Framework:** Python `unittest`.
- **Locations:**
  - `tests/` — 12 test files (server, OCR engine, PDF handler, pipeline manager, Redis, integration)
  - `src/test_*.py` — 4 inline test files (Textract, parsing, enrichment, organization)
- **Run tests:** `python -m unittest discover -s tests` or `python tests/run_tests.py`.
- **Test pattern:** `sys.path.insert(0, ..)` then `from src.<module> import <Class>`.
- **Real AWS tests:** `test_real_integration.py` / `test_real_integration_clean.py` — require AWS credentials.

## Key Rules
- **Never call Next.js/Node.js code from Python.** The AI pipeline is a standalone Flask server.
- **Never generate raw `mongoose.connect()` or repository imports** in Python files. All DB operations go through the frontend API routes.
- **Use `boto3` for all AWS interactions.** Read credentials from environment (boto3 default chain).
- **Use `ThreadPoolExecutor` or `threading.Thread`** for concurrent task execution. Avoid `multiprocessing` (legacy, see `imagePreprocess.py`).
- **Local pipeline requires Redis.** AWS pipeline does not (uses S3 + in-memory tracking).
- **LanceDB is local-only** — stored in `lancedb_data/` on the filesystem, not S3.
- **Chunk large OCR text (>20k chars)** using `intelligent_chunking.py` before passing to Bedrock. Every chunk respects `max_chars_per_chunk`: question boundaries are preferred, and a missing boundary or an overlong section falls back to paragraph, then line, then hard character splits. Parsing stores each chunk's details under `chunk_metadata`. Chunked enrichment must copy that object, including `is_continuation`, onto the enriched chunk before `chunk_merger` runs. Reading a `metadata` key drops the marker and splits one exam into two.
- **Chunked parse failures stay visible.** `parse_chunked_document` returns `failed_chunks` and `status`: `success` only when every chunk parses, `partial` when some chunks fail, and `failed` when all of them do. Chunks that parsed still go through enrichment. `AWSPipelineManager` marks the job `partial_success` when some chunks failed and `failed` when every chunk fails. A non-chunked token-limit failure stays `partial_success`.
- **Clustering write-back failures stay visible.** `cluster_questions_for_job` returns `file_updates` and `failed_keys`. `status` is `success` only when every expected organized file was updated, `partial` when some updates fail, and `failed` when every expected update fails. Files with no similar questions are not expected updates. `AWSPipelineManager` copies `failed_keys` onto the clustering stage and marks that stage `partial` or `failed`. The job is `partial_success` when any expected file was not updated. A truthy clustering summary is not stage success.
- **S3 is the canonical data store** for all AWS pipeline stages. Each stage reads the previous stage's output from S3 and writes its own output to S3.
