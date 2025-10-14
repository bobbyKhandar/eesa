# 🚀 AI Pipeline - Future Development Plans

## 🎯 Current Bottleneck

The pipeline processes PDFs **sequentially** (one at a time), which is slow:
- **OCR**: 70-80% of time (slowest part)
- **Image Preprocessing**: 15-20%
- **PDF Splitting**: 5-10%

**Problem**: Python's GIL prevents true CPU parallelism with threads.

## 💡 Proposed Solution: Multiprocessing with Redis Queues

### Core Idea
Split work across **multiple processes** using **Redis queues** for coordination.

### Worker Distribution (8-core example)
- **1 core**: Flask Server (HTTP)
- **1 core**: OCR Worker (memory-heavy)
- **6 cores**: Preprocessing Workers (CPU-intensive)

### Pipeline Flow
```
Server → ai_pipeline_queue
           ↓
    PDF Splitter (Thread 1)
           ↓
    queue:image:preprocess
           ↓
    Preprocessing Workers (N-2 cores) ← Multiple processes in parallel
           ↓
    queue:ocr
           ↓
    OCR Worker (1 core)
           ↓
    queue:merge
           ↓
    PDF Merger (Thread 2)
           ↓
    queue:result:final → Frontend
```

### How It Works

1. **Server receives batch** → Push to `ai_pipeline_queue`
2. **PDF Splitter** (Thread 1):
   - Pops PDFs from queue
   - Splits into pages
   - Pushes pages to `queue:image:preprocess`
3. **Preprocessing Workers** (Multiple processes):
   - Each worker grabs pages from queue
   - Processes in parallel
   - Pushes to `queue:ocr`
4. **OCR Worker** (Single process):
   - Extracts text from preprocessed images
   - Stores results in Redis
   - When PDF complete → Push to `queue:merge`
5. **PDF Merger** (Thread 2):
   - Assembles all pages for each PDF
   - Pushes final result to `queue:result:final`
   - Sends STOP when batch complete

### Key Benefits
- ✅ Process multiple PDFs simultaneously
- ✅ Redis handles inter-process communication
- ✅ Each PDF can fail independently
- ✅ Progress tracking via Redis metadata

## 📊 Expected Impact

**Current**: 10 PDFs = ~100 seconds (sequential)  
**With Multiprocessing**: 10 PDFs = ~20-30 seconds (**3-5x faster** on 8-core machine)

Note: Single PDF won't get faster, but batches will process in parallel.

## ⚠️ Challenges to Consider

- **Complexity**: Thread + Process coordination is tricky
- **Memory**: OCR workers need 2-4GB each, preprocessing ~50MB per worker
- **Error Handling**: Need worker crash recovery and graceful shutdown
- **STOP Signal**: Careful coordination needed to shutdown cleanly

## 🛠️ Implementation Effort

```
Simple ProcessPoolExecutor:  1-2 days   | 3-4x speedup   | Low maintenance
Custom Multiprocessing:      2-3 weeks  | 5-8x speedup   | High maintenance  
Celery (Task Queue):         3-5 days   | 5-8x speedup   | Medium maintenance
```

## 🎯 Alternative: Celery

Instead of building custom multiprocessing, **Celery** is a proven task queue used by Instagram, Airbnb:
- ✅ Built-in monitoring (Flower UI)
- ✅ Automatic retries
- ✅ Distributed workers
- ❌ Requires more research to understand the package
- ❌ Additional operational overhead

-[authors note]Celery has not been reviewed yet by the owner (me) so it cannot be certain that this project would support it in future,still it is a potential option to consider.

## 📝 Next Steps
1. **Profile current system** to confirm OCR is the bottleneck
2. **Start simple**: Try `ProcessPoolExecutor` first (1-2 days)
3. **If needed**: Implement full multiprocessing architecture (2-3 weeks)
4. **Research Celery** as production alternative

---

**Status**: Proposal | **Author**: Bobby | **Date**: Oct 2025
