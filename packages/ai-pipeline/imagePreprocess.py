import json
import time
import gc
from pathlib import Path
from pdf2image import convert_from_path
from PIL import Image
import cv2
import numpy as np
import easyocr
import re
import os
import constants
from datetime import datetime
import shutil
import random
import fitz
import multiprocessing
import uuid
from database import jobDatabase
import concurrent.futures
from .log import logger
import redis

# Initialize global Redis connection

class OcrPipeline:
    def __init__(self,resource_level:constants.resource_level,inputFilePath:str):
        self.resource_level=resource_level
        self.inputFilePath=inputFilePath
        self.currentDirectory=os.getcwd()
        self.PreProcessImage=OcrPipeline.PreProcessImage()
        self.ocrEngine=OcrPipeline.ocr()
        os.makedirs(self.currentDirectory+"/ocr/failedJobs",exist_ok=True)
        self.db=jobDatabase(str(uuid.uuid4()))
        self.log=logger(self.currentDirectory+"/ocr/logs")
        self.log.info("OCR Pipeline initialized")
        self.handler=self.jobHandler()
        self.imageProcessingQueue=multiprocessing.Queue()
        self.ocrQueue=multiprocessing.Queue()

    def startOcr(self):
        self.log.info("Creating jobs...")
        self.__createJobs__()
        self.log.info("Jobs created.")
        
        while (job:=self.__getNextJob__()) is not None:
            self.log.info(f"Processing request ID: {job.request_id}")
            self.handler.processJob(job)
            if job["status"]==constants.JobStatus.COMPLETE:
                self.db.updateJobResult(job["id"],job["confidence"],job["text"])
                self.log.info(f"Request ID: {job.request_id} completed successfully.")
            else:
                self.db.updateJobError(job["id"],job["error"])
                self.log.error(f"Request ID: {job.request_id} failed with error: {job['error']}")
                
    def __createJobs__(self):
        jobListPath=self.inputFilePath.rglob("*.pdf")
        for job in jobListPath:
            jobLists=[]
            jobStr=str(job)
            jobPdf=fitz.open(jobStr)
            pageCount=jobPdf.page_count
            jobId=uuid.uuid4()
            for i in range(1,pageCount+1):
                taskList={"jobId":jobId,"jobLocation":jobStr,"pageNo":i,"finalPage":False}
                if i is pageCount:
                    taskList["finalPage"]=True
                r.hset("imageProcessingQueue",mapping={f"{jobId}_{i}":json.dumps(taskList)})
            jobLists.append({"jobId":jobId,"jobLocation":jobStr})
        self.db.insertMultipleJobs(jobLists)#add id in object

    def __getNextJob__(self):
        if self.db.getPendingJobCount()<=0:
            self.log.info("No pending jobs found, checking for failed jobs to retry...")
            return self.db.getNextFailedJob(retries=3)
        else:
            return self.db.getNextPendingJob()
    
    class jobHandler:
        def __init__(self,imageProcessingQueue,ocrTaskQueue):
            self.imagePreprocesser=OcrPipeline.PreProcessImage()
            self.ocrEngine=OcrPipeline.ocr()
            self.ocrWorker=multiprocessing.Process()
            self.imagePreprocesserWorker=multiprocessing.Process()
            self.imageProcessingQueue=imageProcessingQueue
            self.ocrTaskQueue=ocrTaskQueue
            self.ocrOutputCache={}

        def start(self,pdfFilePaths):
            numCpuCores=os.cpu_count()-2
            #todo log the cpu cores found
        

        def processOcr(self):
            while True:
                try:
                    pid=os.getpid()
                    # logger.info(f"Started Ocr with process id {pid}")
                    if (task:=self.ocrTaskQueue.get()) is None:
                        logger.info(f"No more tasks to process ending process{pid}")
                        break
                    task["status"]="processingByOcr"
                    result=self.ocrEngine(task["image"])
                    
                    if task["finalPage"]:
                        self.finalizeOcrResults(task["id"])
                except Exception as e:
                    logger.error(f"error at processId {pid} while doing ocr error:-{e}")
        
        def finalizeOcrResults(self,taskId):
            if taskId in self.ocrOutputCache:
                result=self.ocrOutputCache[taskId]
                # finalize the results (e.g., save to database, log, etc.)
                logger.info(f"Finalizing OCR results for taskId {taskId}")
                # Remove from cache
                del self.ocrOutputCache[taskId]
            
            

        def processPreprocessing(self):
            while True:
                try:
                    if (task:=self.imageProcessingQueue.get()) is None:
                        break#Todo log breaking event
                    task["status"]="InImageProcessing"
                    doc=fitz.open(task["jobLocation"])
                    page=doc.load_page(task["pageNo"])
                    pix=page.get_pixMap(dpi=400)
                    doc.close()
                    image=np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
                    processedImage=self.imagePreprocesser.imagePreprocess(image)
                    task["image"]=processedImage
                    task["status"]="InOcrTaskQueue"
                    self.ocrTaskQueue.put(task)
                except :
                    print("dd")
        
        def mergeResults(task):
            
            


        

        def processJob(self,job):
            try:
                pageCount= self.__createTasks__()
                avgConfidencePdf,totalConfidencePdf=0,0
                finalResult=""
                while not self.processers.empty():
                    imageMeta=self.processers.get()
                    preprocessedImage=self.processImage()
                    result=self.processOcr(preprocessedImage)
                    if result["success"]:
                        totalConfidencePdf+=result["confidence"]
                        finalResult+=" ".join([t["text"] for t in result["text"]])+" "
                    else:
                        raise Exception(result["error"])
                    if images:
                        avgConfidencePdf=totalConfidencePdf/len(images)
                    else:
                        avgConfidencePdf=0
                    job["confidence"]=avgConfidencePdf
                    job["text"]=finalResult
                    job["status"]=constants.JobStatus.COMPLETE
            except Exception as e:
                job["status"]=constants.JobStatus.ERROR
                job["error"]=str(e)
            finally:
                gc.collect()
                return job

        
        def processImage(self,image):   
            preprocessedImage=self.imagePreprocesser.imagePreprocess(image)
            return preprocessedImage
        
        def processOcr(self,image):
            result=self.ocrEngine.processImage(image,allowDebugging=True)
            sanitizedResult=self.ocrEngine.sanitize(result["text"]) if result["success"] else result
            result["text"]=sanitizedResult
            return result
        
                
    class PreProcessImage:
        def imagePreprocess(self,img):
            opencv_img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
            gray = cv2.cvtColor(opencv_img, cv2.COLOR_BGR2GRAY)
            denoised = cv2.fastNlMeansDenoising(gray, h=16)    
            angle = self.detect_skew_angle(denoised)
            if abs(angle) < 0.1:
                deskewed = denoised
            else:
                (h, w) = denoised.shape[:2]
                center = (w // 2, h // 2)
                M = cv2.getRotationMatrix2D(center, angle, 1.0)
                cos_val, sin_val = np.abs(M[0, 0]), np.abs(M[0, 1])
                new_w, new_h = int(h * sin_val + w * cos_val), int(h * cos_val + w * sin_val)
                M[0, 2] += (new_w / 2) - center[0]
                M[1, 2] += (new_h / 2) - center[1]
                deskewed = cv2.warpAffine(denoised, M, (new_w, new_h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=255)
            thresh = cv2.adaptiveThreshold(deskewed, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                           cv2.THRESH_BINARY, 11, 2)
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 1))
            cleaned = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel)
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
            final_img = clahe.apply(cleaned)
            return final_img
            
        def detect_skew_angle(image):
            angles = []
            edges = cv2.Canny(image, 30, 100, apertureSize=3)
            for threshold in [50, 100, 150]:
                lines = cv2.HoughLines(edges, 1, np.pi/360, threshold=threshold)
                if lines is not None and len(lines) > 5:
                    line_angles = []
                    for line in lines[:50]:
                        rho, theta = line[0]
                        angle = np.rad2deg(theta) - 90
                        if abs(angle) < 10:
                            line_angles.append(angle)
                    if line_angles:
                        hist, bin_edges = np.histogram(line_angles, bins=20, range=(-10, 10))
                        max_bin_idx = np.argmax(hist)
                        mode_angle = (bin_edges[max_bin_idx] + bin_edges[max_bin_idx + 1]) / 2
                        angles.append(mode_angle)
                        break
            horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (40, 1))
            horizontal_lines = cv2.morphologyEx(edges, cv2.MORPH_OPEN, horizontal_kernel)
            contours, _ = cv2.findContours(horizontal_lines, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            horizontal_angles = []
            for contour in contours:
                if cv2.contourArea(contour) > 200 and len(contour) > 10:
                    [vx, vy, x, y] = cv2.fitLine(contour, cv2.DIST_L2, 0, 0.01, 0.01)
                    angle = np.rad2deg(np.arctan2(vy, vx))
                    if abs(angle) < 15:
                        horizontal_angles.append(angle)
            if horizontal_angles:
                angles.append(np.median(horizontal_angles))
            contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if contours:
                largest = max(contours, key=cv2.contourArea)
                if cv2.contourArea(largest) > image.shape[0] * image.shape[1] * 0.1:
                    rect = cv2.minAreaRect(largest)
                    angle = rect[2]
                    if angle < -45:
                        angle += 90
                    elif angle > 45:
                        angle -= 90
                    if abs(angle) < 15:
                        angles.append(-angle)
            if not angles:
                return 0
            final_angle = np.median(angles)            
            if abs(final_angle) < 0.5:
                fine_edges = cv2.Canny(image, 20, 60)
                lines = cv2.HoughLines(fine_edges, 0.5, np.pi/720, threshold=30)
                if lines is not None:
                    fine_angles = []
                    for line in lines[:100]:
                        rho, theta = line[0]
                        angle = np.rad2deg(theta) - 90
                        if abs(angle) < 5:
                            fine_angles.append(angle)
                    if fine_angles:
                        return np.median(fine_angles)
            return final_angle

    class ocr:   
        def __init__(self,db):
            self.reader = easyocr.Reader(['en'])

        def processImage(self,image, allowDebugging=True):
            try:
                results = self.reader.readtext(image,decoder="beamsearch",beamWidth=15,batch_size=8,detail=1,paragraph=False,min_size=20)
                text = [{"text":text,"confidence":conf} for _,text,conf in results]
                totalConf=sum([conf for _,_,conf in results])
                avgConfidence=(totalConf/len(results) if len(results)>0 else 0)
                return{"success":True,"text": text, "confidence": avgConfidence}
            
            except Exception as e:
                return{"success":False,"error":str(e)}

        def sanitize(text: str) -> str:
            # 1. Strip ASCII control chars (except \t, \n, \r)
            text = re.sub(r'[\x00-\x08\x0B-\x0C\x0E-\x1F]', '', text)

            # 2. Normalize quotes → regular double/single quotes
            text = text.replace("“", '"').replace("”", '"')
            text = text.replace("‘", "'").replace("’", "'")

            # 3. Remove soft hyphen + zero-width junk
            text = re.sub(r'[\u00ad\u200b\u200c\u200d\ufeff]', '', text)

            # 4. Escape backslashes that aren't valid JSON escapes
            text = re.sub(r'\\(?!["\\/bfnrtu])', r'\\\\', text)

            # 6. Remove trailing commas before } or ]
            text = re.sub(r",\s*([}\]])", r"\1", text)

            # 7. Collapse multiple spaces/tabs
            text = re.sub(r'[ \t]+', ' ', text)

            # 8. Fix inner quotes: keep outer ", replace inner " with '
            text = re.sub(r'"([^"]*)"',lambda m: '"' + m.group(1).replace('"', "'") + '"',text)

            # 9. Strip leading/trailing commas/colons (extra safety)
            text = re.sub(r'^[\s,:]+', '', text)
            text = re.sub(r'[\s,:]+$', '', text)

            # 10. Trim leading/trailing whitespace
            return text.strip()
    