# OCR Pipeline

A multi-processing OCR pipeline that converts PDF files to text using image preprocessing and EasyOCR.

## Features

- **Multi-processing**: Utilizes multiple CPU cores for parallel processing
- **Image Preprocessing**: Advanced image processing to improve OCR accuracy
- **Redis Queue**: Optional Redis support for distributed processing
- **Error Handling**: Comprehensive error handling and logging
- **Skew Correction**: Automatic detection and correction of skewed documents

## Installation

1. Install Python dependencies:
```bash
pip install -r requirements-ocr.txt
```

2. Install system dependencies (Ubuntu/Debian):
```bash
sudo apt-get install poppler-utils
```

3. Install system dependencies (Windows):
   - Download and install Poppler for Windows
   - Add poppler `bin` directory to your PATH

## Usage

### Basic Usage

```python
from imagePreprocess import OcrPipeline
import constants

# Initialize pipeline
pipeline = OcrPipeline(
    resource_level=constants.resource_level.MEDIUM,
    inputFilePath="/path/to/pdf/directory"
)

# Start processing
pipeline.startOcr()
```

### Testing

Run the test script:
```bash
python test_ocr_pipeline.py
```

Make sure to place some PDF files in the `test_pdfs/` directory first.

## Configuration

### Resource Levels
- `LOW`: Minimal CPU usage
- `MEDIUM`: Balanced CPU usage (recommended)
- `HIGH`: Maximum CPU usage

### Redis (Optional)
The pipeline can use Redis for job queuing. If Redis is not available, it falls back to in-memory queues.

To use Redis:
1. Install and start Redis server
2. The pipeline will automatically detect and use Redis

## Architecture

1. **Job Creation**: Scans input directory for PDF files and creates processing jobs
2. **Image Preprocessing**: Converts PDF pages to images and applies preprocessing
3. **OCR Processing**: Performs OCR on preprocessed images
4. **Result Aggregation**: Combines results from all pages of a document

## Dependencies

- **OpenCV**: Image processing and preprocessing
- **EasyOCR**: OCR engine
- **PyMuPDF**: PDF processing
- **Redis**: Optional job queuing
- **NumPy**: Numerical operations

## Error Handling

The pipeline includes comprehensive error handling:
- Job retry mechanism for failed jobs
- Detailed logging of all operations
- Graceful fallback when Redis is unavailable

## Performance Tips

1. Adjust resource level based on your system
2. Use SSD storage for better I/O performance
3. Ensure sufficient RAM for large documents
4. Use Redis for better job distribution in multi-machine setups