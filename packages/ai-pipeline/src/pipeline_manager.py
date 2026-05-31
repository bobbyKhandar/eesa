"""
AI Pipeline Manager - Main orchestrator for the OCR processing pipeline
Handles batch processing, job management, and result compilation
"""

import sys
import os
from pathlib import Path

# Add current directory to Python path for imports
current_dir = Path(__file__).parent
sys.path.insert(0, str(current_dir))

import json
import uuid
import time
import threading
from typing import Dict, List, Optional, Any
from dataclasses import dataclass
from enum import Enum
import cv2

try:
    from . import redis_client
    from .local_ocr_engine import OCREngine
    from .local_image_processor_pipeline import ImageProcessor
    from .pdf_handler import PDFHandler
except ImportError:
    import redis_client
    from local_ocr_engine import OCREngine
    from local_image_processor_pipeline  import ImageProcessor
    from pdf_handler import PDFHandler


class JobStatus(Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class BatchRequest:
    """Represents a batch processing request from Node.js"""
    batch_id: str
    file_locations: List[str]
    options: Dict[str, Any] = None
    created_at: float = None
    
    def __post_init__(self):
        if self.created_at is None:
            self.created_at = time.time()
        if self.options is None:
            self.options = {}


@dataclass
class BatchResult:
    """Represents the final result of a batch processing operation"""
    batch_id: str
    status: JobStatus
    total_files: int
    successful_files: int
    failed_files: int
    processing_time: float
    results: Dict[str, Any]
    errors: List[str]
    completed_at: float = None
    
    def __post_init__(self):
        if self.completed_at is None:
            self.completed_at = time.time()
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "batch_id": self.batch_id,
            "status": self.status.value,
            "total_files": self.total_files,
            "successful_files": self.successful_files,
            "failed_files": self.failed_files,
            "processing_time": self.processing_time,
            "results": self.results,
            "errors": self.errors,
            "completed_at": self.completed_at
        }


class PipelineManager:
    """
    Main pipeline manager that orchestrates the entire OCR processing workflow
    """
    
    def __init__(self):
        self.ocr_engine = OCREngine()
        self.image_processor = ImageProcessor()
        self.pdf_handler = PDFHandler()
        self.active_batches: Dict[str, BatchRequest] = {}
        self.processing_lock = threading.Lock()
        self.is_running = False
        
    def start_server(self):
        """Start the pipeline server to process batches"""
        self.is_running = True
        print("🚀 AI Pipeline Server started")
        
        # Start background processing thread
        processing_thread = threading.Thread(target=self._process_batches_continuously, daemon=True)
        processing_thread.start()
        
        print("✅ Background processing thread started")
    
    def stop_server(self):
        """Stop the pipeline server"""
        self.is_running = False
        print("🛑 AI Pipeline Server stopped")
    
    def submit_batch(self, file_locations: List[str], options: Dict[str, Any] = None) -> str:
        """
        Submit a batch of PDF files for processing
        
        Args:
            file_locations: List of PDF file paths to process
            options: Optional processing parameters
            
        Returns:
            batch_id: Unique identifier for tracking the batch
        """
        batch_id = str(uuid.uuid4())
        
        # Create batch request
        batch_request = BatchRequest(
            batch_id=batch_id,
            file_locations=file_locations,
            options=options or {}
        )
        
        # Store batch metadata
        batch_metadata = {
            "batch_id": batch_id,
            "file_locations": file_locations,
            "status": JobStatus.PENDING.value,
            "total_files": len(file_locations),
            "processed_files": 0,
            "failed_files": 0,
            "created_at": batch_request.created_at,
            "options": batch_request.options
        }
        
        # Store in Redis
        redis_client.hash_set(f"batch:{batch_id}", "metadata", batch_metadata)
        
        # Add to processing queue
        redis_client.queue_push(redis_client.RedisKeys.QUEUE_MAIN_INTAKE, batch_id)
        
        # Track locally
        with self.processing_lock:
            self.active_batches[batch_id] = batch_request
        
        print(f"📝 Submitted batch {batch_id} with {len(file_locations)} files")
        return batch_id
    
    def get_batch_status(self, batch_id: str) -> Optional[Dict[str, Any]]:
        """Get the current status of a batch"""
        try:
            metadata = redis_client.hash_get_json(f"batch:{batch_id}", "metadata")
            if not metadata:
                return None
            
            # Calculate progress
            total_files = metadata.get("total_files", 0)
            processed_files = metadata.get("processed_files", 0)
            progress_percentage = (processed_files / total_files * 100) if total_files > 0 else 0
            
            return {
                "batch_id": batch_id,
                "status": metadata.get("status"),
                "total_files": total_files,
                "processed_files": processed_files,
                "failed_files": metadata.get("failed_files", 0),
                "progress_percentage": round(progress_percentage, 2),
                "created_at": metadata.get("created_at"),
                "processing_time": time.time() - metadata.get("created_at", time.time())
            }
        except Exception as e:
            print(f"Error getting batch status: {e}")
            return None
    
    def get_batch_result(self, batch_id: str) -> Optional[BatchResult]:
        """Get the final result of a completed batch"""
        try:
            # Get metadata
            metadata = redis_client.hash_get_json(f"batch:{batch_id}", "metadata")
            if not metadata:
                return None
            
            # Get results
            results_data = redis_client.hash_get_json(f"batch:{batch_id}", "results") or {}
            errors = redis_client.hash_get_json(f"batch:{batch_id}", "errors") or []
            
            # Create result object
            result = BatchResult(
                batch_id=batch_id,
                status=JobStatus(metadata.get("status", "unknown")),
                total_files=metadata.get("total_files", 0),
                successful_files=metadata.get("processed_files", 0) - metadata.get("failed_files", 0),
                failed_files=metadata.get("failed_files", 0),
                processing_time=metadata.get("processing_time", 0),
                results=results_data,
                errors=errors,
                completed_at=metadata.get("completed_at", time.time())
            )
            
            return result
        except Exception as e:
            print(f"Error getting batch result: {e}")
            return None
    
    def _process_batches_continuously(self):
        """Background thread that continuously processes batches from the queue"""
        print("🔄 Started continuous batch processing")
        
        while self.is_running:
            try:
                # Get next batch from queue
                batch_id = redis_client.queue_pop(redis_client.RedisKeys.QUEUE_MAIN_INTAKE)
                
                if batch_id and batch_id != "STOP":
                    print(f"🎯 Processing batch: {batch_id}")
                    self._process_single_batch(batch_id)
                else:
                    # No batches available, wait a bit
                    time.sleep(1)
                    
            except Exception as e:
                print(f"Error in batch processing loop: {e}")
                time.sleep(5)  # Wait longer on error
    
    def _process_single_batch(self, batch_id: str):
        """Process a single batch of PDF files"""
        start_time = time.time()
        
        try:
            # Get batch metadata
            metadata = redis_client.hash_get_json(f"batch:{batch_id}", "metadata")
            if not metadata:
                print(f"❌ Batch metadata not found: {batch_id}")
                return
            
            # Update status to processing
            metadata["status"] = JobStatus.PROCESSING.value
            redis_client.hash_set(f"batch:{batch_id}", "metadata", metadata)
            
            file_locations = metadata["file_locations"]
            batch_results = {}
            batch_errors = []
            processed_files = 0
            failed_files = 0
            
            print(f"📄 Processing {len(file_locations)} PDF files in batch {batch_id}")
            
            # Process each PDF file
            for i, file_location in enumerate(file_locations):
                try:
                    print(f"  📖 Processing file {i+1}/{len(file_locations)}: {file_location}")
                    
                    # Process the PDF file
                    file_result = self._process_pdf_file(file_location, batch_id)
                    
                    if file_result["success"]:
                        batch_results[file_location] = file_result
                        processed_files += 1
                        print(f"  ✅ Successfully processed: {file_location}")
                        print(f"     - Total Pages: {file_result['total_pages']}")
                        print(f"     - Successful Pages: {file_result['successful_pages']}")
                        print(file_result)
                    else:
                        batch_errors.append(f"Failed to process {file_location}: {file_result.get('error', 'Unknown error')}")
                        failed_files += 1
                        print(f"  ❌ Failed to process: {file_location}")
                    
                    # Update progress

                    metadata["processed_files"] = processed_files + failed_files
                    metadata["failed_files"] = failed_files
                    redis_client.hash_set(f"batch:{batch_id}", "metadata", metadata)
                    
                except Exception as e:
                    error_msg = f"Error processing {file_location}: {str(e)}"
                    batch_errors.append(error_msg)
                    failed_files += 1
                    print(f"  ❌ {error_msg}")
            
            # Calculate final statistics
            processing_time = time.time() - start_time
            successful_files = processed_files
            
            # Update final metadata
            metadata["status"] = JobStatus.COMPLETED.value if failed_files == 0 else JobStatus.FAILED.value
            metadata["processing_time"] = processing_time
            metadata["completed_at"] = time.time()
            
            # Store results
            redis_client.hash_set(f"batch:{batch_id}", "metadata", metadata)
            redis_client.hash_set(f"batch:{batch_id}", "results", batch_results)
            redis_client.hash_set(f"batch:{batch_id}", "errors", batch_errors)
            
            # Add to final results queue for Node.js to pick up
            final_result = {
                "batch_id": batch_id,
                "status": metadata["status"],
                "total_files": len(file_locations),
                "successful_files": successful_files,
                "failed_files": failed_files,
                "processing_time": processing_time,
                "results": batch_results,
                "errors": batch_errors
            }
            
            redis_client.queue_push(redis_client.RedisKeys.QUEUE_RESULTS_FINAL, json.dumps(final_result))
            
            # Clean up local tracking
            with self.processing_lock:
                if batch_id in self.active_batches:
                    del self.active_batches[batch_id]
            
            print(f"✅ Completed batch {batch_id}: {successful_files} successful, {failed_files} failed, {processing_time:.2f}s")
            
        except Exception as e:
            print(f"❌ Error processing batch {batch_id}: {e}")
            
            # Mark batch as failed
            try:
                metadata = redis_client.hash_get_json(f"batch:{batch_id}", "metadata") or {}
                metadata["status"] = JobStatus.FAILED.value
                metadata["processing_time"] = time.time() - start_time
                metadata["completed_at"] = time.time()
                redis_client.hash_set(f"batch:{batch_id}", "metadata", metadata)
                redis_client.hash_set(f"batch:{batch_id}", "errors", [str(e)])
            except Exception as cleanup_error:
                print(f"Error during cleanup: {cleanup_error}")
    
    def _process_pdf_file(self, file_location: str, batch_id: Optional[str] = None) -> Dict[str, Any]:
        """Process a single PDF file through the OCR pipeline"""
        try:
            # Extract pages from PDF
            pages_data = self.pdf_handler.extract_pages(file_location)
            
            if not pages_data:
                return {"success": False, "error": "No pages extracted from PDF"}
            
            file_results = []
            total_confidence = 0
            
            # Process each page
            for page_data in pages_data:
                try:
                    # Preprocess image
                    processed_image = self.image_processor.preprocess_image(page_data["image"])

                    # Save preprocessed image for analysis/debugging if batch_id provided
                    try:
                        # Build output directory: processed_images/{batch_id}/{file_stem}/
                        base_name = Path(file_location).stem
                        out_dir = Path(current_dir.parent) / "processed_images"
                        if batch_id:
                            out_dir = out_dir / str(batch_id)
                        out_dir = out_dir / base_name
                        out_dir.mkdir(parents=True, exist_ok=True)

                        out_path = out_dir / f"page_{int(page_data['page_number']):03}.png"
                        # Attempt to write image using OpenCV
                        cv2.imwrite(str(out_path), processed_image)
                        # attach path for downstream visibility
                        page_data["processed_image_path"] = str(out_path)
                    except Exception as save_err:
                        print(f"⚠️ Could not save processed image for {file_location} page {page_data.get('page_number')}: {save_err}")

                    # Perform OCR
                    ocr_result = self.ocr_engine.process_image(processed_image)
                    
                    if ocr_result["success"]:
                        page_result = {
                            "page_number": page_data["page_number"],
                            "text": ocr_result["text"],
                            "confidence": ocr_result["confidence"],
                            "success": True
                        }
                        file_results.append(page_result)
                        total_confidence += ocr_result["confidence"]
                    else:
                        file_results.append({
                            "page_number": page_data["page_number"],
                            "error": ocr_result.get("error", "OCR processing failed"),
                            "success": False
                        })
                
                except Exception as page_error:
                    file_results.append({
                        "page_number": page_data["page_number"],
                        "error": str(page_error),
                        "success": False
                    })
            
            # Calculate average confidence
            successful_pages = [r for r in file_results if r.get("success")]
            avg_confidence = total_confidence / len(successful_pages) if successful_pages else 0
            
            # Combine all text
            combined_text = "\n\n".join([r["text"] for r in successful_pages])
            
            return {
                "success": True,
                "file_location": file_location,
                "total_pages": len(pages_data),
                "successful_pages": len(successful_pages),
                "failed_pages": len(file_results) - len(successful_pages),
                "average_confidence": avg_confidence,
                "combined_text": combined_text,
                "page_results": file_results
            }
            
        except Exception as e:
            return {"success": False, "error": str(e)}


# Singleton instance
pipeline_manager = PipelineManager()