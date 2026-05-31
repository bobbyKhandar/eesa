# AI Pipeline Domain Rules — Python/Flask

## Framework & Setup
- **Framework:** Flask (Python 3.10+). No blueprints — routes are registered directly on the `app` object.
- **Dependencies:** Listed in `requirements-ocr.txt`. Key packages: `opencv-python`, `easyocr`, `pdf2image`, `PyMuPDF`, `Pillow`, `numpy`, `redis`, `lancedb`, `hdbscan`, `pyarrow`, `boto3`.
- **CORS:** `flask-cors` — all servers enable `CORS(app)`.

## Server Entry Point

### `src/api/server.py` — Canonical Server
- Module-level `app = Flask(__name__)` + `CORS(app)` — serves as the WSGI entry point.
- All routes registered via decorators at import time (for Gunicorn/WSGI compatibility).
- `AIServer` class wraps the module-level `app` for non-blocking thread lifecycle (`start_server()` / `stop_server()`).
- **Threading:** `ThreadPoolExecutor(max_workers=3)` with lazy double-checked init for background AWS jobs.
- **Job persistence:** S3-backed metadata with in-memory LRU cache (100-job limit with eviction).
- **Startup:** `python src/api/server.py` (blocking), `start_server()` (non-blocking), or via `wsgi.py` (Gunicorn).
- **Used by:** `wsgi.py` (production), `start_server.py` (development), `src/server.py` (bootstrap re-exporter).
- **Routes:** `/health`, `/process`, `/process/batch`, `/job/<id>/status`, `/job/<id>/metadata`, `/job/<id>/questions`, `/jobs/active`, `/submit-local`, `/submit` (legacy), `/submit-aws`, `/status-aws/<job_id>`, `/status/<batch_id>`, `/result/<batch_id>`, `/upload/question-papers`.

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
- **Image processing:** `ImageProcessor` class (`src/local_image_processor_pipeline.py`).
- **PDF handling:** `PDFHandler` class using PyMuPDF (`src/pdf_handler.py`).
- **Queue management:** Redis via `redis_client.py` — required for local pipeline. Connection: `redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)`.
- **Pipeline manager:** `PipelineManager` singleton (`src/pipeline_manager.py`) — uses background thread for continuous batch processing.

## Module Architecture

### Core Pipeline Modules
| Module | Role |
|---|---|
| `src/aws_texttract_pipeline.py` | Async Textract OCR via `start_document_text_detection()` + polling |
| `src/parsing_pipeline.py` | Bedrock parsing with Gemma 3 27B — extracts Q&A from OCR text |
| `src/enrich_questions_job_based.py` | Bedrock enrichment — Bloom's taxonomy, difficulty, keywords, syllabus |
| `src/organize_by_subject_job_based.py` | Groups enriched questions into subject-organized JSON on S3 |
| `src/intelligent_chunking.py` | Splits large OCR text (20k+ chars) at question boundaries for batch processing |
| `src/chunk_merger.py` | Validates and merges chunked parsing results |
| `src/question_clustering.py` | LanceDB vector store + FAISS/HDBSCAN for similarity clustering and appearance frequency |
| `src/local_ocr_engine.py` | EasyOCR-based OCR engine with GPU auto-detect |
| `src/local_image_processor_pipeline.py` | Image preprocessing (denoise, sharpen, binarize, deskew, contrast enhancement) |
| `src/pdf_handler.py` | PDF page extraction via PyMuPDF at configurable DPI |
| `src/pipeline_manager.py` | Redis-backed local pipeline manager (singleton) |
| `src/pipeline_orchestrator.py` | Orchestration layer — upload, process, download, save workflow |

### API Module (`src/api/`)
| File | Role |
|---|---|
| `__init__.py` | Exports `create_app`, `start_server`, `stop_server`, `AWSPipelineManager` |
| `server.py` | Module-level Flask app with CORS, route registration, `AIServer` class for thread lifecycle |
| `routes.py` | Route definitions via `register_routes()` function — 14 routes covering production + legacy paths |
| `aws_manager.py` | `AWSPipelineManager` — full 5-stage pipeline orchestration, S3 metadata persistence, bounded thread pool |
| `question_retriever.py` | Question retrieval with 3-level S3 fallback (organized → enriched → parsed), Bloom's taxonomy stats |

### Supporting Modules
| File | Role |
|---|---|
| `src/enrich_questions_s3_pipeline.py` | Standalone S3-based enrichment with `ThreadPoolExecutor(20)` |
| `src/organize_by_subject.py` | Local filesystem-based subject organization |
| `src/manual_pipeline.py` | 1818-line CLI pipeline (upload → OCR → parse → enrich → organize) with SQLite tracking |
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
- **S3 bucket:** `eesa-pipeline-storage` (from env `S3_BUCKET` or default).
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
- **Chunk large OCR text (>20k chars)** using `intelligent_chunking.py` before passing to Bedrock.
- **S3 is the canonical data store** for all AWS pipeline stages. Each stage reads the previous stage's output from S3 and writes its own output to S3.
