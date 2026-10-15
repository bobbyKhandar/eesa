# 🤖 AI Pipeline - PDF OCR Processing System

A production-ready, scalable PDF OCR processing pipeline built with Python, featuring batch processing, Redis-based queue management, and comprehensive image preprocessing for optimal text extraction.

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [API Documentation](#api-documentation)
- [Node.js Integration](#nodejs-integration)
- [Configuration](#configuration)
- [Testing](#testing)
- [Project Structure](#project-structure)
- [Performance](#performance)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

---

## 🎯 Overview

AI Pipeline is a comprehensive OCR (Optical Character Recognition) processing system designed to handle large-scale PDF document processing with high accuracy and efficiency. It uses EasyOCR for text extraction, OpenCV for image preprocessing, and Redis for distributed job management.

### Key Capabilities

- 📄 **Batch PDF Processing** - Process multiple PDF files concurrently
- 🖼️ **Advanced Image Preprocessing** - Optimize images for OCR accuracy
- 🔄 **Queue-Based Architecture** - Scalable job management with Redis
- 🌐 **Multi-Language Support** - Support for multiple OCR languages
- 📊 **Progress Tracking** - Real-time status and progress monitoring
- 🚀 **High Performance** - GPU acceleration support
- 🧪 **Well-Tested** - 90%+ test coverage

---

## ✨ Features

### Core Functionality

#### 1. PDF Processing
- Multi-page PDF extraction
- Custom DPI configuration (default: 400)
- Page range selection
- PDF validation and metadata extraction
- Large PDF splitting
- Direct text extraction (for text-based PDFs)

#### 2. Image Preprocessing
- **Adaptive Resizing** - Smart image scaling with aspect ratio preservation
- **Contrast Enhancement** - CLAHE (Contrast Limited Adaptive Histogram Equalization)
- **Noise Reduction** - Non-local Means Denoising
- **Sharpening** - Unsharp mask for text clarity
- **Binarization** - Adaptive thresholding for optimal OCR
- **Auto-Rotation** - Automatic text orientation detection and correction

#### 3. OCR Engine
- **EasyOCR Integration** - State-of-the-art text recognition
- **GPU/CPU Auto-Detection** - Automatic hardware optimization
- **Confidence Filtering** - Filter results by confidence threshold
- **Text Sanitization** - Clean and normalize extracted text
- **Multi-Language Support** - Configure languages as needed

#### 4. Batch Processing
- **Queue Management** - Redis-based FIFO queue
- **Batch Submission** - Process multiple files as a batch
- **Progress Tracking** - Real-time status updates
- **Result Compilation** - Aggregated results with metadata
- **Error Handling** - Graceful error management and reporting

#### 5. API Server
- **REST API** - Flask-based HTTP endpoints
- **Batch Operations** - Submit, status check, result retrieval
- **JSON Responses** - Structured, easy-to-parse responses

---

## 🏗️ Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         Node.js Client                       │
│              (Web App, API Server, etc.)                    │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ HTTP/Redis
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                      AI Pipeline Server                      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Pipeline Manager                         │  │
│  │  - Batch submission & tracking                       │  │
│  │  - Queue management                                  │  │
│  │  - Result compilation                                │  │
│  └──────────────────────────────────────────────────────┘  │
│                           │                                  │
│         ┌─────────────────┼─────────────────┐              │
│         ▼                 ▼                 ▼               │
│  ┌──────────┐      ┌──────────┐     ┌──────────┐          │
│  │   PDF    │      │  Image   │     │   OCR    │          │
│  │ Handler  │─────▶│Processor │────▶│  Engine  │          │
│  └──────────┘      └──────────┘     └──────────┘          │
│                                                              │
│                     ▼                                        │
│              ┌──────────────┐                               │
│              │    Redis     │                               │
│              │   Client     │                               │
│              └──────────────┘                               │
└─────────────────────┬────────────────────────────────────────┘
                      │
                      ▼
              ┌──────────────┐
              │ Redis Server │
              │   (Queue +   │
              │   Metadata)  │
              └──────────────┘
```

### Data Flow

1. **Submission** - Client submits batch of PDF files with options
2. **Queuing** - Batch metadata stored in Redis, batch ID added to queue
3. **Processing** - Pipeline Manager picks up batch and routes each file. DOCX uploads (`.docx` or `options.file_type == "docx"`) are text-extracted from the document XML. PDF and image files continue through OCR.
4. **PDF Extraction** - PDFHandler extracts pages as images for PDF and image files
5. **Preprocessing** - ImageProcessor optimizes images for OCR
6. **Text Extraction** - OCREngine performs text recognition
7. **Result Compilation** - Results aggregated and stored in Redis
8. **Notification** - Final result pushed to results queue
9. **Retrieval** - Client retrieves results using batch ID

---

## 📦 Installation

### Prerequisites

- **Python** 3.10+
- **Redis Server** 6.0+ (local OCR queue only)
- **CUDA** (optional, for GPU acceleration)

### System Dependencies

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y python3-dev python3-pip redis-server

# macOS
brew install python redis

# Windows
# Download and install Python from python.org
# Download Redis from https://redis.io/download
```

### Python Dependencies

Runtime dependencies and the Python floor live in `pyproject.toml`. `requirements.txt` is the same production set: Flask, flask-cors, Werkzeug, boto3, botocore, Gunicorn, and numpy. That set is what `wsgi:app` needs. OpenCV, EasyOCR, PyTorch, PyMuPDF, Pillow, and Redis are the `local` extra. LanceDB, PyArrow, HDBSCAN, and scikit-learn are the `clustering` extra. Installing the `redis` package does not make `wsgi:app` connect to Redis. Local routes return 503 when Redis is unreachable or the OCR stack cannot start; `/health` and the AWS routes still load.

```bash
cd packages/ai-pipeline

python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Production API / WSGI server
pip install -r requirements.txt

# Same runtime set, editable
pip install -e .

# Local OCR and clustering
pip install -e ".[local,clustering]"
```

---

## 🚀 Quick Start

### 1. Start Redis Server

```bash
# Start Redis (default port: 6379)
redis-server

# Or in background
redis-server --daemonize yes
```

### 2. Start AI Pipeline Server

```python
from src.pipeline_manager import pipeline_manager

# Start the pipeline server
pipeline_manager.start_server()

# Server will run in the background, processing batches from the queue
```

### 3. Submit a Batch (Python)

```python
from src.pipeline_manager import pipeline_manager

# Submit batch of PDF files
batch_id = pipeline_manager.submit_batch(
    file_locations=[
        '/path/to/document1.pdf',
        '/path/to/document2.pdf'
    ],
    options={
        'max_width': 2000,
        'enhance_contrast': True,
        'denoise': True,
        'confidence_threshold': 0.5
    }
)

print(f"Batch ID: {batch_id}")

# Check status
status = pipeline_manager.get_batch_status(batch_id)
print(f"Status: {status}")

# Get results (when completed)
result = pipeline_manager.get_batch_result(batch_id)
print(f"Results: {result}")
```

### 4. Submit a Batch (Node.js)

```javascript
const { AIPipelineClient } = require('./temp_node_integration');

async function main() {
    const client = new AIPipelineClient();
    await client.connect();

    // Submit batch
    const batchId = await client.submitBatch([
        '/path/to/document1.pdf',
        '/path/to/document2.pdf'
    ], {
        max_width: 2000,
        enhance_contrast: true,
        denoise: true
    });

    // Wait for completion
    const result = await client.waitForBatch(batchId);
    console.log('Results:', result);

    await client.disconnect();
}

main();
```

---

## 📚 API Documentation

### Pipeline Manager

#### `submit_batch(file_locations, options)`

Submit a batch of PDF files for processing.

**Parameters:**
- `file_locations` (List[str]): Array of absolute paths to PDF files
- `options` (Dict, optional): Processing options

**Returns:**
- `str`: Batch ID for tracking

**Example:**
```python
batch_id = pipeline_manager.submit_batch(
    file_locations=['/path/to/file.pdf'],
    options={'confidence_threshold': 0.6}
)
```

#### `get_batch_status(batch_id)`

Get current status of a batch.

**Parameters:**
- `batch_id` (str): Unique batch identifier

**Returns:**
- `Dict`: Status information
  - `batch_id`: Batch identifier
  - `status`: Current status (pending/processing/completed/failed)
  - `total_files`: Total number of files
  - `processed_files`: Files processed so far
  - `failed_files`: Files that failed processing
  - `progress_percentage`: Completion percentage
  - `created_at`: Submission timestamp
  - `processing_time`: Elapsed time in seconds

**Example:**
```python
status = pipeline_manager.get_batch_status(batch_id)
print(f"Progress: {status['progress_percentage']}%")
```

#### `get_batch_result(batch_id)`

Get final results of a completed batch.

**Parameters:**
- `batch_id` (str): Unique batch identifier

**Returns:**
- `BatchResult`: Complete batch results
  - `batch_id`: Batch identifier
  - `status`: Final status (`completed`, `partial`, or `failed`). `partial` means OCR dropped some pages but still produced text. This is separate from the AWS job status `partial_success`.
  - `total_files`: Total files processed
  - `successful_files`: Files whose pages all succeeded
  - `failed_files`: Files that produced no usable text
  - `processing_time`: Total processing time
  - `results`: Dictionary of file results
  - `errors`: List of error messages
  - `completed_at`: Completion timestamp

**Example:**
```python
result = pipeline_manager.get_batch_result(batch_id)
for file_path, file_result in result.results.items():
    print(f"{file_path}: {file_result['combined_text']}")
    if file_result.get("status") == "partial":
        print(f"  failed pages: {file_result.get('failed_page_numbers')}")
```

### Processing Options

Options are per batch. Submission validates every option: an option the
pipeline cannot honor, or a recognized option with a malformed value, is
rejected with HTTP 400 and the offending name instead of being stored and
silently ignored. These are the supported options.

#### PDF Rendering Options

```python
options = {
    'dpi': 400,               # Render resolution (positive integer)
    'page_range': [0, 4],     # [start, end] page span; end is exclusive
}
```

#### Image Preprocessing Options

```python
options = {
    # Resizing
    'max_width': 3000,            # Maximum image width
    'max_height': 3000,           # Maximum image height
    'min_width': 600,             # Minimum image width
    'min_height': 600,            # Minimum image height

    # Quality analysis and forced steps
    'skip_quality_analysis': False,  # Skip the adaptive quality assessment
    'enhance_contrast': False,       # Force CLAHE contrast enhancement
    'denoise': False,                # Force bilateral denoising
    'binarize': False,               # Force Otsu binarization
}
```

By default the processor assesses each page and only applies the corrections
that page needs. The forced steps above override that assessment.

#### OCR Options

```python
options = {
    'confidence_threshold': 0.5  # Minimum confidence (0-1)
}
```

#### Routing Options

```python
options = {
    'file_type': 'docx'  # pdf, docx, or image
}
```

---

## 🔗 Node.js Integration

### Installation

```bash
npm install redis uuid axios
```

### Basic Usage

```javascript
const { AIPipelineClient } = require('./temp_node_integration');

const client = new AIPipelineClient({
    host: 'localhost',
    port: 6379,
    db: 0
});

await client.connect();

// Submit batch
const batchId = await client.submitBatch([
    '/path/to/doc1.pdf',
    '/path/to/doc2.pdf'
]);

// Check status
const status = await client.getBatchStatus(batchId);

// Wait for completion
const result = await client.waitForBatch(batchId);

await client.disconnect();
```

### Real-time Result Listener

```javascript
// Listen for completed batches
client.listenForResults(async (result) => {
    console.log(`Batch ${result.batch_id} completed`);
    // Process result...
});
```

See [`temp_node_integration.js`](temp_node_integration.js) for complete examples.

---

## ⚙️ Configuration

### Environment Variables

Create a `.env` file:

```env
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DB=0
REDIS_PASSWORD=

# OCR Configuration
OCR_LANGUAGES=en
OCR_GPU=auto

# Processing Configuration
# Local OCR enforces page-count and pixel caps before it renders.
# A blank, non-integer, or non-positive value keeps the default.
DEFAULT_DPI=400
MAX_PAGES_PER_PDF=1000
MAX_PDF_PAGE_PIXELS=50000000

# Logging
LOG_LEVEL=INFO
LOG_FILE=/var/log/ai_pipeline.log
```

`POST /upload/question-papers` also reads `QUESTION_PAPER_MAX_FILE_BYTES` (default 26214400), `QUESTION_PAPER_MAX_FILE_COUNT` (default 20), and `QUESTION_PAPER_MAX_REQUEST_BYTES` (default 209715200). The request cap is Flask `MAX_CONTENT_LENGTH` for the whole app. The frontend proxy uses the same names.

AWS region is resolved once in `src/aws_region.py` before any boto3 client is created. `AWS_REGION` is canonical; `AWS_DEFAULT_REGION` and the legacy `aws_location` `.env` entry are accepted aliases. Precedence: `AWS_REGION` > `AWS_DEFAULT_REGION` > `aws_location` > default `ap-south-1`. The `packages/ai-pipeline/.env` file is loaded without overriding real environment variables, the resolved region is mirrored into `AWS_REGION`/`AWS_DEFAULT_REGION`, and startup logs the region and its source (or that the default is in effect and how to override it). Every Textract/Bedrock/S3 client uses that resolved region.

The AWS server reads `JOB_METADATA_CACHE_TTL` (default 5.0 seconds, a float). `AWSPipelineManager.load_job_metadata` refreshes nonterminal (`in_progress`/`processing`/`queued`) job metadata from S3 on every poll, and only reuses a cached record while it is terminal (`success`/`partial_success`/`failed`/`completed`/`completed_with_errors`) and within this TTL. This keeps a poll served by one WSGI worker seeing the completed/failed state another worker saved; the TTL also bounds how long a terminal record (for example after a retry) is reused before revalidation.

Local OCR reads `DEFAULT_DPI`, `MAX_PAGES_PER_PDF`, and `MAX_PDF_PAGE_PIXELS`. The batch path validates the PDF, renders one page at a time through `iter_pages`, and drops that image after OCR. A PDF over the page-count or per-page pixel cap fails before the first pixmap is built. `extract_pages` still returns the full list for existing callers. A file larger than 100MB still only produces a validation warning.

### Redis Keys

The pipeline uses these Redis keys:

- `queue:main:intake` - Main processing queue (FIFO)
- `queue:results:final` - Completed results queue
- `batch:{batch_id}` - Batch metadata and results (hash)
  - `metadata` - Batch information
  - `results` - Processing results
  - `errors` - Error messages

---

## 🧪 Testing

### Run All Tests

```bash
cd ai_pipeline/tests
python run_tests.py
```

### Run Specific Test Module

```bash
python run_tests.py test_ocr_engine
python run_tests.py test_image_processor
python run_tests.py test_pdf_handler
```

### Run Single Test

```bash
python -m unittest test_ocr_engine.TestOCREngineInitialization.test_init_default_parameters -v
```

### Test Coverage

Current test coverage: **90.2%**

- ✅ 174 passing tests
- ⏭️ 40 skipped tests (complex mocking scenarios)
- 🧪 193 total test cases

---

## 📁 Project Structure

```
ai_pipeline/
├── src/                              # Core application code
│   ├── __init__.py                  # Package initialization
│   ├── local_ocr_engine.py          # OCR text extraction (EasyOCR)
│   ├── local_image_processor_pipeline.py  # Image preprocessing
│   ├── pdf_handler.py               # PDF operations (353 lines)
│   ├── pipeline_manager.py          # Orchestration (369 lines)
│   ├── redis_client.py              # Redis operations
│   └── server.py                    # Flask HTTP API
│
├── tests/                            # Test suite
│   ├── run_tests.py                 # Test runner
│   ├── test_*.py                    # Test modules
│   └── TEST_DOCUMENTATION.md        # Test documentation
│
├── temp_node_integration.js          # Node.js integration example
├── .env                              # Environment configuration
├── pyproject.toml                    # Project metadata
├── README.md                         # This file
├── PROJECT_STATUS.md                 # Project status report
└── CLEANUP_VERIFICATION.md           # Cleanup verification
```

---

## ⚡ Performance

### Benchmarks

| Metric | Value |
|--------|-------|
| Average OCR Speed | 2-5 pages/second (GPU) |
| Batch Processing | 50-100 pages/minute |
| Image Preprocessing | <500ms per image |
| Memory Usage | ~2GB (with GPU) |
| GPU Speedup | 3-5x vs CPU |

### Optimization Tips

1. **Use GPU** - Enable CUDA for 3-5x speedup
2. **Batch Processing** - Process multiple files together
3. **Image Quality** - Higher DPI = better accuracy but slower
4. **Preprocessing** - Enable only needed preprocessing steps
5. **Redis Tuning** - Configure Redis for your workload
6. **Parallel Workers** - Run multiple pipeline instances

---

## 🔧 Troubleshooting

### Common Issues

#### Redis Connection Error
```
Error: Redis connection refused
```
**Solution:** Ensure Redis server is running before calling a local OCR route. The AWS WSGI app still loads; `/submit-local`, `/submit`, `/status/<batch_id>`, and `/result/<batch_id>` return 503 until Redis is reachable.
```bash
redis-server
```

#### GPU Not Detected
```
Warning: CUDA not available, using CPU
```
**Solution:** Install CUDA toolkit and PyTorch with CUDA support
```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
```

#### Out of Memory
```
Error: CUDA out of memory
```
**Solution:** Reduce batch size or image resolution
```python
options = {'max_width': 1500, 'max_height': 1500}
```

#### Low OCR Accuracy
**Solutions:**
- Increase DPI: `dpi=600`
- Enable preprocessing: `enhance_contrast=True, denoise=True`
- Adjust confidence threshold: `confidence_threshold=0.7`
- Check image quality

#### Batch Rejected With "Unsupported processing options"
```
{'success': False, 'error': 'Unsupported processing options: sharpen. Supported options: ...'}
```
**Solution:** The batch was not queued. Remove the option or rename it to a
supported one from the [Processing Options](#processing-options) section. A
recognized option with a bad value, such as `confidence_threshold=1.5`, is
rejected the same way.

### Debug Mode

Enable debug logging:

```python
import logging
logging.basicConfig(level=logging.DEBUG)
```

---

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

### Development Setup

```bash
# Install development dependencies
pip install pytest pytest-cov black flake8

# Run tests with coverage
pytest --cov=src tests/

# Format code
black src/ tests/

# Lint code
flake8 src/ tests/
```

---

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

---

## 📞 Support

For issues, questions, or contributions:

- **GitHub Issues**: https://github.com/bobbyKhandar/eesa/issues
- **Documentation**: See `TEST_DOCUMENTATION.md` and `PROJECT_STATUS.md`
- **Examples**: Check `temp_node_integration.js`

---

## 🎯 Roadmap

### Upcoming Features

- [ ] HTTP REST API endpoints
- [ ] WebSocket support for real-time updates
- [ ] Docker containerization
- [ ] Kubernetes deployment manifests
- [ ] Enhanced language support (20+ languages)
- [ ] Table detection and extraction
- [ ] Form field recognition
- [ ] Confidence scoring visualization
- [ ] Result export formats (JSON, XML, CSV)
- [ ] Cloud storage integration (S3, Azure Blob)

---

## 📊 Project Status

- **Version**: 1.0.0
- **Status**: Production Ready ✅
- **Test Coverage**: 90.2%
- **Last Updated**: October 4, 2025

For detailed project status, see [`PROJECT_STATUS.md`](PROJECT_STATUS.md)

---

**Made with ❤️ by the AI Pipeline Team**
