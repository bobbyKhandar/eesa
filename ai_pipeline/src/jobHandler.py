
if __name__ == "__main__":
    import json
    import os
    import time
    import gc
    import queue
    from pathlib import Path
    import uuid

    import fitz
    import numpy as np
    import cv2

    from src import ocr, imagePreprocess
    import multiprocessing
    from src import redis_client
    
    # Redis is required for operation
    if not redis_client.is_redis_available():
        raise Exception("Redis is required for the job handler to work. Please make sure Redis server is running.")
        
    
class jobHandler:
        def __init__(self):
            self.ocrEngine = ocr.Ocr()
            # Initialize Redis-based OCR output cache
            self.processResults = {}
            self.ocrOutputCache = {}

            total_cores = multiprocessing.cpu_count()
            # Reserve 1 core for OS operations
            available_cores = max(2, total_cores - 1)
            # Allocate workers: multiple preprocessing workers + 1 OCR worker
            preprocessing_workers = max(1, available_cores - 1)  # Most cores for preprocessing
            
            print(f"Total CPU cores: {total_cores}")
            print(f"Available cores: {available_cores} (reserved 1 for OS)")
            print(f"Preprocessing workers: {preprocessing_workers}")
            print(f"OCR workers: 1")
            self.imageProcessor = imagePreprocess.PreProcessImage(workers=preprocessing_workers)
            # Check if there are jobs to process in Redis queues
            if not redis_client.are_queues_empty():
                self.imageProcessor.start()
                self.processOcr()
                self.mergeJobs()#merge different jobs(images) from same pdfs into one 
            else:
                # Check for any pending job requests in the intake queue
                job = redis_client.redis_client.lrange("ai_pipeline_queue", 0, 0)
                if job:
                    self.__createJobs__(job)
            print(f"Initial job in queue: {job}")

        def __createJobs__(self, jobPath):
            pipeline_id=str(uuid.uuid4())
            pipeline_pdfs_Ids=[]
            pipeline_pdfs_paths = list(str(Path(str(os.getcwd()).replace("\\","/")+f"/uploads/{jobPath}").rglob("*.pdf")))
            for pdfPath in pipeline_pdfs_paths:
                pdfMeta = fitz.open(pdfPath)
                fitz.close()
                pageCount = pdfMeta.page_count
                pdfId = str(uuid.uuid4())
                pagesId = []
                for i in range(pageCount):
                    pageId = str(uuid.uuid4())
                    pagesId.append(pageId)
                    pagesList = {
                        "pageId": pageId,
                        "pdfLocation": pdfPath,
                        "pdfId": pdfId, #images from the same pdf would be merged based on their pdfId
                        "pageNo": i,
                        "status": "inImageProcessingQueue",
                        "result": "",
                        "retryCount": 0,
                        "imageData": ""
                    }    
                    print(f"Adding job to queue: {pagesList}")
                    redis_client.queue_push(redis_client.RedisKeys.QUEUE_IMAGE_PREPROCESS, pageId)
                    redis_client.store_page_metadata_dict(pageId, pagesList)
                    task_id = str(uuid.uuid4())
                    taskMeta={
                        "taskId": task_id,
                        "totalPages":pageCount,
                        "processedPages":0,
                        "jobsIds":pagesId,
                        "processedJobsIds":[],
                        "status":"inProgress",
                    }
                    redis_client.hash_set(redis_client.RedisKeys.TASK_METADATA, task_id, taskMeta)

        def mergeJobs(self):
            while job := redis_client.queue_pop(redis_client.RedisKeys.QUEUE_MERGE) != "STOP":
                try:
                    taskMeta = redis_client.hash_get_json(redis_client.RedisKeys.TASK_METADATA, job) or {}
                    taskId = taskMeta.get("taskId")
                    print(f"All pages processed for taskId {taskId}, finalizing job")
                    processedJobsIds = taskMeta.get("processedJobsIds", [])
                    # Fetch all processed job results
                    finalText = ""
                    finalConfidence = 0
                    for jobId in processedJobsIds:
                        jobData = redis_client.hash_get_all(jobId)
                        if jobData and jobData.get("status") == "complete":
                            result = json.loads(jobData.get("result","{}"))
                            finalText += result.get("text","") + "\n"
                            finalConfidence += result.get("confidence",0)
                    totalPages = taskMeta.get("totalPages", len(processedJobsIds))
                    avgConfidence = finalConfidence / totalPages if totalPages > 0 else 0
                    # Store final result
                    finalJobId = str(uuid.uuid4())
                    finalJob = {
                        "jobId": finalJobId,
                        "taskId": taskId,
                        "text": finalText.strip(),
                        "confidence": avgConfidence,
                        "status": "complete"
                    }
                    redis_client.hash_set_map(finalJobId, finalJob)
                    redis_client.queue_push(redis_client.RedisKeys.QUEUE_RESULTS_FINAL, finalJobId)
                    redis_client.hash_delete(redis_client.RedisKeys.QUEUE_MERGE, taskId)
                    print(f"Finalized job for taskId {taskId}, stored in final_results_queue")
                except Exception as e:
                    print(f"Error in job merger worker: {e}")
                    continue
            
            print(f"Job merger worker completed.")

        def start(self):
            self.imageProcessor.start()

        def processOcr(self):
            """OCR worker - single worker to handle all OCR tasks"""
            worker_name = multiprocessing.current_process().name
            pid = os.getpid()
            print(f"Starting OCR worker: {worker_name} (PID: {pid})")
            
            processed_count = 0
            while True:
                try:
                    # Get task from Redis OCR queue
                    task_id = redis_client.queue_pop(redis_client.RedisKeys.QUEUE_OCR)
                    
                    if task_id is None:
                        # No tasks in queue, wait and try again
                        time.sleep(1)
                        continue
                    
                    if task_id == "STOP":
                        print(f"Received STOP signal, ending OCR worker {pid}")
                        break
                        
                    # Get the task data from Redis
                    task = redis_client.get_page_metadata(task_id)
                    
                    # Update task status
                    redis_client.update_page_metadata(task_id, "status", "processingByOcr")
                    
                    # Get image data from preprocessing or regenerate
                    if "imageData" in task and task["imageData"]:
                        # Decode hex image data
                        image_bytes = bytes.fromhex(task["imageData"])
                        image = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
                    else:
                        # Regenerate image from PDF
                        doc = fitz.open(task["pdfLocation"])
                        page = doc.load_page(int(task["pageNo"]))
                        pix = page.get_pixmap(dpi=400)
                        doc.close()
                        
                        # Convert to numpy array
                        if pix.n == 4:  # RGBA
                            image = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
                            image = cv2.cvtColor(image, cv2.COLOR_RGBA2RGB)
                        else:  # RGB
                            image = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
                    
                    result = self.ocrEngine.processImage(image)
                    
                    # Store result in cache
                    jobId = task.get("jobId", task_id)
                    if jobId not in self.ocrOutputCache:
                        self.ocrOutputCache[jobId] = []
                    
                    self.ocrOutputCache[jobId].append({
                        "pageNo": int(task.get("pageNo", 0)),
                        "result": result,
                        "confidence": result.get("confidence", 0),
                        "text": result.get("text", [])
                    })
                    
                    processed_count += 1
                    
                    # Check if this is the final page
                    current_page = int(task.get("pageNo", 0))
                    total_pages = int(task.get("totalPages", 1))
                    if current_page >= total_pages - 1:
                        print(f"{worker_name}: Processing final page for job {jobId}, finalizing results")
                        self.finalizeOcrResults(jobId)
                        
                except queue.Empty:
                    # Timeout occurred
                    if processed_count == 0:
                        continue
                    else:
                        print(f"OCR worker {pid} - Timeout after processing {processed_count} pages, shutting down")
                        break
                except Exception as e:
                    print(f"Error at OCR worker {pid} while doing OCR: {e}")
                    continue
            
            print(f"OCR worker {worker_name} (PID: {pid}) completed. Processed {processed_count} pages.")
        
        def finalizeOcrResults(self, jobId):
            if jobId in self.ocrOutputCache:
                results = self.ocrOutputCache[jobId]
                
                # Sort by page number
                results.sort(key=lambda x: x["pageNo"])
                
                # Combine all text and calculate average confidence
                combined_text = ""
                total_confidence = 0
                text_count = 0
                
                for page_result in results:
                    if page_result["result"].get("success", False):
                        page_texts = page_result["result"].get("text", [])
                        for text_item in page_texts:
                            if isinstance(text_item, dict):
                                combined_text += text_item.get("text", "") + " "
                                total_confidence += text_item.get("confidence", 0)
                                text_count += 1
                            else:
                                combined_text += str(text_item) + " "
                                text_count += 1
                
                avg_confidence = total_confidence / text_count if text_count > 0 else 0
                
                # Store final result
                self.processResults[jobId] = {
                    "text": combined_text.strip(),
                    "confidence": avg_confidence,
                    "status": "complete" # Will be replaced with proper constant
                }
                
                print(f"Finalized OCR results for jobId {jobId}")
                # Remove from cache
                del self.ocrOutputCache[jobId]

        def processPreprocessing(self):
            """Image preprocessing worker - handles multiple tasks"""
            worker_name = multiprocessing.current_process().name
            print(f"Starting preprocessing worker: {worker_name}")
            
            processed_count = 0
            while True:
                try:
                    # Get task from Redis queue
                    task = None
                    # Get from Redis processing queue
                    keys = redis_client.hash_keys(redis_client.RedisKeys.QUEUE_IMAGE_PROCESSING)
                    if keys:
                        key = keys[0]
                        task_json = redis_client.hash_get(redis_client.RedisKeys.QUEUE_IMAGE_PROCESSING, key)
                        if task_json:
                            redis_client.hash_delete(redis_client.RedisKeys.QUEUE_IMAGE_PROCESSING, key)
                            task = json.loads(task_json)
                    
                    if task is None:
                        # Check if we've processed some items but now there are none
                        if processed_count > 0:
                            # Short sleep to not hammer Redis
                            time.sleep(0.5)
                            continue
                        # If we haven't processed anything yet, wait longer
                        time.sleep(1)
                        continue
                    
                    task["status"] = "InImageProcessing"
                    
                    # Process the PDF page
                    doc = fitz.open(task["jobLocation"])
                    page = doc.load_page(task["pageNo"])
                    pix = page.get_pixmap(dpi=400)
                    doc.close()
                    
                    # Convert to numpy array
                    if pix.n == 4:  # RGBA
                        image = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
                        image = cv2.cvtColor(image, cv2.COLOR_RGBA2RGB)
                    else:  # RGB
                        image = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
                    
                    # Preprocess the image  
                    from src.imagePreprocess import PreProcessImage
                    preprocessor = PreProcessImage()
                    processedImage = preprocessor.imagePreprocess(image)
                    task["image"] = processedImage
                    task["status"] = "InOcrTaskQueue"
                    
                    # Update task status
                    redis_client.update_page_metadata(task["pageId"], "status", "ready_for_ocr")
                    # Add to OCR queue
                    redis_client.queue_push(redis_client.RedisKeys.QUEUE_OCR, task["pageId"])
                    processed_count += 1
                    
                    # Small delay to prevent overwhelming the system
                    time.sleep(0.01)
                    
                except Exception as e:
                    print(f"Error in preprocessing worker {worker_name}: {e}")
                    continue
                    
            print(f"Preprocessing worker {worker_name} completed. Processed {processed_count} pages.")
    
        def processJob(self, job):
            """Process a complete job (PDF file) - simplified version using the worker system"""
            try:
                jobId = job.get("jobId") or job.get("id")
                if not jobId:
                    raise Exception("No jobId found in job")
                
                # Wait for job to complete (check processResults)
                max_wait = 300  # 5 minutes timeout
                wait_time = 0
                
                while jobId not in self.processResults and wait_time < max_wait:
                    time.sleep(1)
                    wait_time += 1
                
                if jobId in self.processResults:
                    result = self.processResults[jobId]
                    job["confidence"] = result["confidence"]
                    job["text"] = result["text"]
                    job["status"] = result["status"]
                    del self.processResults[jobId]  # Clean up
                else:
                    raise Exception("Job processing timeout")
                    
            except Exception as e:
                from ai_pipeline.constants import JobStatus
                job["status"] = JobStatus.ERROR
                job["error"] = str(e)
            finally:
                gc.collect()
                return job
                