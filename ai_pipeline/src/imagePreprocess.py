import json
import cv2
import fitz
import multiprocessing as mp
import time
import numpy as np
from src import redis_client

class PreProcessImage:
    def start(self, workers=1):
        self.workers = workers
        workersprocesses = []
        for i in range(self.workers):
            # Add STOP signal to queue for each worker
            redis_client.queue_push(redis_client.RedisKeys.QUEUE_IMAGE_PREPROCESS, "STOP")
            p = mp.Process(target=self.jobHandler, name=f"Preprocessor-{i+1}")
            p.start()
            workersprocesses.append(p)
        return workersprocesses
    
    def jobHandler(self):
        while True:
            try:
                # Get job from preprocessing queue
                jobId = redis_client.queue_pop(redis_client.RedisKeys.QUEUE_IMAGE_PREPROCESS)
                
                if jobId:
                    if jobId == 'STOP':
                        break
                        
                    print(f"Processing image: {jobId}")
                    job = redis_client.get_page_metadata(jobId)
                    
                    if not job:
                        print(f"No metadata found for job {jobId}")
                        continue
                        
                    print(f"Job details: {job}")
                    
                    # Update job status
                    redis_client.update_page_metadata(jobId, "status", "preprocessing")
                    
                    # Get image from PDF
                    imgPath = job.get("pdfLocation")
                    pageNo = int(job.get("pageNo", 0))
                    
                    doc = fitz.open(imgPath)
                    page = doc.load_page(pageNo)
                    pix = page.get_pixmap(dpi=400)
                    doc.close()
                    
                    # Convert to numpy array
                    if pix.n == 4:  # RGBA
                        image_np = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
                        image_np = cv2.cvtColor(image_np, cv2.COLOR_RGBA2RGB)
                    else:  # RGB
                        image_np = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
                  
                    # Preprocess the image
                    processed_img = self.imagePreprocess(image_np)
                    
                    # Encode processed image
                    _, buffer = cv2.imencode('.png', processed_img)
                    bufferHexBites = buffer.tobytes().hex()
                    
                    # Store processed image data
                    redis_client.update_page_metadata(jobId, "imageData", bufferHexBites)
                    redis_client.update_page_metadata(jobId, "status", "ready_for_ocr")
                    
                    # Add to OCR queue
                    redis_client.queue_push(redis_client.RedisKeys.QUEUE_OCR, jobId)
                    
                else:
                    print("No job found, waiting...")
                    time.sleep(1)
                    
            except Exception as e:
                print(f"Error in image preprocessing: {e}")
                if jobId:
                    redis_client.update_page_metadata(jobId, "status", "error")
                    redis_client.update_page_metadata(jobId, "error", str(e))
                time.sleep(1)

    def imagePreprocess(self, img):
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
            
    def detect_skew_angle(self, image):
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