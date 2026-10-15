# AI Pipeline Domain Rules — Python/Flask

## Framework & Setup
- **Framework:** Flask (Python 3.10+). No blueprints — routes are registered directly on the `app` object.
- **Dependencies:** Declared in `pyproject.toml` (`requires-python >=3.10`) and mirrored in `requirements.txt`. Runtime: `flask`, `flask-cors`, `werkzeug`, `boto3`, `botocore`, `gunicorn`, `numpy`. Optional `local`: `opencv-python`, `easyocr`, `torch`, `PyMuPDF`, `Pillow`, `redis`. Optional `clustering`: `lancedb`, `hdbscan`, `pyarrow`, `scikit-learn`. Optional `dev`: `pytest`, `pytest-cov`, `requests`.
- **CORS:** `flask-cors` — all servers enable `CORS(app)`. CORS does not authenticate callers.
- **Service auth:** Every route except `GET /health` requires `Authorization: Bearer $AI_PIPELINE_TOKEN` and a loopback (or `AI_PIPELINE_TRUSTED_HOSTS`) address. User and role checks stay in the Next.js helpers (`jobContentAccessDecision`, upload-session ownership, `requireAdminCaller`). The production listener binds to `127.0.0.1` unless `AI_PIPELINE_ALLOW_PUBLIC_BIND=1`.
- **Question-paper upload limits:** `POST /upload/question-papers` reads `QUESTION_PAPER_MAX_FILE_BYTES` (default 25 MB), `QUESTION_PAPER_MAX_FILE_COUNT` (default 20), and `QUESTION_PAPER_MAX_REQUEST_BYTES` (default 200 MB). `register_routes` sets Flask `MAX_CONTENT_LENGTH` to that request cap, so every route rejects a larger body with 413. The upload route returns 413 for an oversized file or body and 400 for too many files before it stores anything. Accepted PDFs are streamed to S3 with `upload_fileobj`. A non-PDF in an otherwise valid batch is still reported as an error and is not stored.

## Server Entry Point

### `src/api/server.py` — Canonical Server
- Module-level `app = Flask(__name__)` + `CORS(app)` — serves as the WSGI entry point.
- All routes registered via decorators at import time (for Gunicorn/WSGI compatibility).
- `AIServer` class wraps the module-level `app` for non-blocking thread lifecycle (`start_server()` / `stop_server()`).
- **Threading:** `ThreadPoolExecutor(max_workers=3)` with lazy double-checked init for background AWS jobs.
- **Job persistence:** S3-backed metadata with a process-local in-memory cache (100-job limit with eviction, oldest 20 by key). The cache is the source of truth only for the worker that owns a running job; other workers must not serve a stale snapshot. `load_job_metadata` therefore refreshes any **nonterminal** record (`in_progress`, `processing`, `queued`, or missing status) from S3 on every poll, and reuses a cached record only when it is **terminal** (`success`, `partial_success`, `failed`, `completed`, `completed_with_errors`) and within its TTL. This keeps a poll served by one WSGI worker seeing the completed/failed state saved to S3 by the processing worker. Because there is no shared/coherent state, a terminal record cached on another worker is refreshed at most `JOB_METADATA_CACHE_TTL` seconds later (default 5.0), which also bounds how long a retry's reset to `in_progress` takes to propagate; the value is a float in seconds. When S3 is unreachable or the object is absent, `load_job_metadata` falls back to the last cached value instead of dropping the job. Verified by `tests/test_metadata_cache_refresh.py`.
- **Startup:** `python src/api/server.py` (blocking), `start_server()` (non-blocking), or via `wsgi.py` (Gunicorn).
- **Local pipeline startup:** `wsgi:app` does not import `pipeline_manager`. The first call to `/submit-local`, `/submit`, `/status/<batch_id>`, or `/result/<batch_id>` loads it. That import pings Redis and, when Redis answers, constructs the OCR singleton. If Redis is unreachable or an OCR dependency is missing, those routes return HTTP 503 with `Local pipeline not available` and the underlying error. `GET /health` and the AWS routes still load. `local_pipeline` on `/health` stays false until the local pipeline has started.
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
- **Queue management:** Redis via `redis_client.py` — required for local pipeline. Connection: `redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)`. The client pings Redis when the module is imported. The API server imports it on the first local route, not while creating the Flask app.
- **Pipeline manager:** `PipelineManager` singleton (`src/pipeline_manager.py`) — uses background thread for continuous batch processing. `_process_single_batch` branches to `_process_docx_file` before `_process_pdf_file`. PDF page outcomes are compiled by `compile_pdf_file_result` (`src/ocr_file_result.py`). A file is `status: success` only when every page succeeds. Dropped pages set `status: partial`, `success: false`, and `failed_pages` / `failed_page_numbers`, and the batch status is `partial` (not `completed`). If every page fails, the file and batch are `failed`. The file payload is still stored so callers can see which pages were lost. This local batch status is separate from the AWS job status `partial_success`. DOCX extraction is unchanged.
- **Processing options:** `submit_batch` validates the caller's options against the allowlist in `src/processing_options.py` and raises `ProcessingOptionsError` for anything unsupported or malformed, so nothing is queued with an option the pipeline would ignore (`/submit-local` and `/submit` answer 400). Only the supported keys are stored in the batch metadata, and `_process_single_batch` passes them to `_process_pdf_file`, which maps them with `pdf_render_options` (dpi, page_range), `preprocessing_options` (resize bounds, `skip_quality_analysis`, and `enhance_contrast` / `denoise` / `binarize` onto the ImageProcessor `force_*` parameters), and `ocr_options` (`confidence_threshold`). `options.file_type` still routes DOCX uploads to text extraction.

## Module Architecture

### Core Pipeline Modules
| Module | Role |
|---|---|
| `src/__init__.py` | Package exports. `PipelineManager`, `pipeline_manager`, `OCREngine`, `ImageProcessor`, `PDFHandler`, and `redis_client` are bound eagerly. `AIServer`, `start_server`, and `stop_server` resolve lazily from `api.server`, so importing the package — including the documented `from src.pipeline_manager import pipeline_manager` — never builds the Flask app |
| `src/aws_texttract_pipeline.py` | Async Textract OCR via `start_document_text_detection()` + polling |
| `src/parsing_pipeline.py` | Bedrock parsing with Gemma 3 27B — extracts Q&A from OCR text. Chunked parsing lists `failed_chunks` and sets `status` to `success`, `partial`, or `failed` |
| `src/enrich_questions_job_based.py` | Bedrock enrichment — Bloom's taxonomy, difficulty, keywords, syllabus. Chunked enrichment reads `chunk_metadata` and keeps continuation markers for the merger |
| `src/organize_by_subject_job_based.py` | Groups enriched questions into subject-organized JSON on S3 |
| `src/intelligent_chunking.py` | Splits large OCR text (20k+ chars) at question boundaries. If no boundary exists, or one section exceeds `max_chars_per_chunk`, falls back to paragraph, then line, then hard character splits so every chunk stays within the maximum. Continuation pieces set `is_continuation` |
| `src/chunk_merger.py` | Validates and merges chunked parsing results. `build_enriched_chunk` copies parsing's `chunk_metadata` — including `is_continuation` and `starts_at_question` — onto each enriched chunk so an exam that crosses a chunk boundary stays one exam. `merge_chunk_exams` merges parsed chunk payloads into one exams envelope: a continuation payload's first exam joins the exam already collected, a question the boundary split is merged once, and any further exam inside that payload stays separate |
| `src/question_clustering.py` | LanceDB vector store + FAISS/HDBSCAN for similarity clustering and appearance frequency. LanceDB ids are `{job}::{organized source key}::{exam id or index}::{question id or number}`, and similarity is written back to that question. Only the exact basenames `_index.json` and `_master_index.json` are index metadata, so subjects containing "index" are clustered. Manifest-listed exam keys missing from the prefix listing are loaded directly. Each organized file write-back is a `file_updates` outcome. `status` is `success` only when every expected file is updated, `partial` when some fail, and `failed` when none are updated. `failed_keys` lists the files that were not updated |
| `src/local_ocr_engine.py` | EasyOCR-based OCR engine with GPU auto-detect |
| `src/local_image_processor_pipeline.py` | Image preprocessing (denoise, sharpen, binarize, deskew, contrast enhancement) |
| `src/pdf_handler.py` | Incremental PDF page rendering via PyMuPDF, with page-count and pixel limits |
| `src/docx_handler.py` | Direct DOCX text extraction from Office Open XML (no OCR) |
| `src/pipeline_manager.py` | Redis-backed local pipeline manager (singleton). DOCX uploads bypass the PDF handler |
| `src/pipeline_orchestrator.py` | Standalone CLI (`<pdf>`, `batch`, `resume`). Enrichment uploads use a source identity from the public helpers in `enrich_questions_s3_pipeline.py` |

### API Module (`src/api/`)
| File | Role |
|---|---|
| `__init__.py` | Exports `create_app`, `start_server`, `stop_server`, `AWSPipelineManager` |
| `server.py` | Module-level Flask app with CORS, route registration, `AIServer` class for thread lifecycle |
| `routes.py` | Route definitions via `register_routes()` function — 15 routes covering production + legacy paths |
| `job_retry.py` | Decides whether a failed job can be re-queued from its stored PDF |
| `aws_manager.py` | `AWSPipelineManager` — full 5-stage pipeline orchestration, S3 metadata persistence, bounded thread pool |
| `question_retriever.py` | Question retrieval with 3-level S3 fallback (organized → enriched → parsed), Bloom's taxonomy stats. Only the exact basenames `_index.json` and `_master_index.json` are index metadata, so subjects containing "index" are retrieved. The organized set is reconciled with `_master_index.json`: manifest-listed exam keys are loaded directly and an incomplete set is supplemented from enriched output without duplicating exams |

### Supporting Modules
| File | Role |
|---|---|
| `src/enrich_questions_s3_pipeline.py` | Standalone S3-based enrichment with `ThreadPoolExecutor(20)`. `processed` and the enriched object key use a source identity (input-relative path plus a short hash of the input directory). Legacy basename entries do not skip a file unless `source_namespace` pins that state to the current directory. `process_all_questions` returns a run summary (`processed`, `newly_processed`, `failed`, `skipped`, `total_files`, `total_cost`, `incomplete_reasons`, `success`); `main(argv)` is the CLI entry point and exits `1` when a file failed or the run was incomplete (missing or empty input directory, file at the retry limit, unsavable state). Supported helpers: `ensure_s3_bucket_exists`, `load_state`, `save_state`, `enrich_single_file`, and `upload_enriched_to_s3(enriched_data, source_id)` |
| `src/organize_by_subject.py` | Local filesystem-based subject organization |
| `src/manual_pipeline.py` | CLI pipeline (upload → OCR → parse → enrich → organize) with SQLite tracking. `--batch-size` on this CLI and on `batch_runner.py` must be an integer >= 1; smaller values are an argparse error. `process_batch` rejects a batch size below 1 and queries retry-pending jobs only when pending jobs leave remaining capacity. `get_jobs_by_phase` requires a finite integer limit >= 1 and always applies that `LIMIT`. Every unsuccessful result funnels through `PhaseProcessor.record_failure`, which moves the row out of `in_progress` to `failed` with a valid `error_phase`, the error detail, and `retry_count + 1`, and writes the `error_log` row plus the error file, so a handled Textract poll or pagination error cannot strand a job outside processing and retry. `process_batch` records a returned failure the processor did not record itself, once per batch. A row left `in_progress` by an interrupted run is reclaimed to `pending` after `STALE_IN_PROGRESS_SECONDS` before the batch selects work, and `batch_runner` reclaims before it counts a phase as empty. Retry targets are validated: `mark_for_retry` and `bulk_mark_for_retry` accept only `ocr`, `parse`, `enrich`, and `organize`; single-job retry falls back from an empty `error_phase` to `current_phase` and refuses a job that is not failed. Parsing splits OCR text longer than 30,000 characters into bounded chunks via `intelligent_chunking`, parses every chunk, and merges only after all of them parsed. A chunk that cannot be parsed fails the job with the unprocessed chunk count and character total instead of advancing a truncated prefix. Enrichment accepts a batch only when every question has a valid Bloom level, difficulty, `keywords` list, and `topicsCovered` list. An incomplete batch is retried up to 3 times, then the job fails instead of advancing to organize |
| `src/redis_client.py` | Redis queue/hash operations for local pipeline job management |
| `src/redisMaster.py` | Documentation of Redis data structure design |
| `src/reprocess_errors.py` | Error reprocessing for Bedrock parsing/enrichment failures. Parsing recovery chunks the OCR text to 6,000-character bounds and saves the merged exams envelope only when every chunk parsed; unprocessed chunks are reported with their character total. Enrichment recovery batches questions (10 questions or 6,000 characters per batch) and saves only when every batch returns one valid classification per question with an in-range `questionIndex`; otherwise the batch and its questions are reported and nothing is saved. Enrichment recovery locates the parsed source by removing the exact `_bloom.error.txt` suffix and preserving the original filename (documented `{subject}_{timestamp}.json_bloom.error.txt` -> `{subject}_{timestamp}.json`); `.json` is appended only for the legacy extensionless `{subject}_bloom.error.txt` -> `{subject}.json`, and any other filename is reported as unsupported |
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
  - `tests/` — unittest modules (server, OCR engine, PDF handler, pipeline manager, Redis, integration, orchestrator helper imports)
  - `src/test_*.py` — 4 inline test files (Textract, parsing, enrichment, organization)
- **Run tests:** `python -m unittest discover -s tests` or `python tests/run_tests.py`.
- **Test pattern:** `sys.path.insert(0, ..)` then `from src.<module> import <Class>`.
- **Real AWS tests:** `test_real_integration.py` / `test_real_integration_clean.py` — require AWS credentials.

## Key Rules
- **Never call Next.js/Node.js code from Python.** The AI pipeline is a standalone Flask server.
- **Never generate raw `mongoose.connect()` or repository imports** in Python files. All DB operations go through the frontend API routes.
- **Use `boto3` for all AWS interactions.** Read credentials from environment (boto3 default chain).
- **Use `ThreadPoolExecutor` or `threading.Thread`** for concurrent task execution. Avoid `multiprocessing` (legacy, see `imagePreprocess.py`).
- **Local pipeline requires Redis.** AWS pipeline does not (uses S3 + in-memory tracking). Installing the Redis client without a running server must not stop `wsgi:app` from loading.
- **LanceDB is local-only** — stored in `lancedb_data/` on the filesystem, not S3.
- **Chunk large OCR text (>20k chars)** using `intelligent_chunking.py` before passing to Bedrock. Every chunk respects `max_chars_per_chunk`: question boundaries are preferred, and a missing boundary or an overlong section falls back to paragraph, then line, then hard character splits. Parsing stores each chunk's details under `chunk_metadata`. Chunked enrichment must copy that object, including `is_continuation`, onto the enriched chunk before `chunk_merger` runs. Reading a `metadata` key drops the marker and splits one exam into two.
- **Chunked parse failures stay visible.** `parse_chunked_document` returns `failed_chunks` and `status`: `success` only when every chunk parses, `partial` when some chunks fail, and `failed` when all of them do. Chunks that parsed still go through enrichment. `AWSPipelineManager` marks the job `partial_success` when some chunks failed and `failed` when every chunk fails. A non-chunked token-limit failure stays `partial_success`.
- **Clustering write-back failures stay visible.** `cluster_questions_for_job` returns `file_updates` and `failed_keys`. `status` is `success` only when every expected organized file was updated, `partial` when some updates fail, and `failed` when every expected update fails. Files with no similar questions are not expected updates. `AWSPipelineManager` copies `failed_keys` onto the clustering stage and marks that stage `partial` or `failed`. The job is `partial_success` when any expected file was not updated, including when clustering returns no result. A truthy clustering summary is not stage success.
- **Index metadata is matched by exact basename.** Organized exam payloads keep the subject in the folder and filename, so only `_index.json` and `_master_index.json` are skipped by retrieval and clustering. Subjects containing "index" are regular exam files. Both readers reconcile the organized set with `_master_index.json` so an omitted exam cannot be reported as complete.
- **S3 is the canonical data store** for all AWS pipeline stages. Each stage reads the previous stage's output from S3 and writes its own output to S3.
