import fitz
from src import imagePreprocess
import os
import redis
import json
import uuid
from pathlib import Path


if __name__ == "__main__":
    try:
        r = redis.Redis(host="localhost",port=6379,decode_responses=True)
        r.ping()
        if r:
            print("redis connected")
        jobListPath = list(Path(str(os.getcwd()).replace("\\","/")+"/tests/imagePreprocessTestData/images").rglob("*.pdf"))
        for job in jobListPath:
            jobStr = str(job)    
            jobPdf = fitz.open(jobStr)
            pageCount = jobPdf.page_count
            for i in range(pageCount):
                jobId = str(uuid.uuid4())
                taskList = {
                    "jobId": jobId,
                    "jobLocation": jobStr,
                    "pageNo": i,
                    "status": "inImageProcessingQueue",
                    "result": "",
                    "retryCount": 0,
                    "imageData": ""
                }     
                print(f"Adding job to queue: {taskList}")
                r.rpush("image_queue",jobId)
                r.hset(jobId,mapping=taskList)
        
    except Exception as e:
        print("redis connection error:-")
        print(e)

def test_image_preprocessSingleWorker():
    p=imagePreprocess.PreProcessImage().start(workers=1)
    for worker in p:
        worker.join()
        
def test_image_preprocess():
    p = imagePreprocess.PreProcessImage().start(workers=4)
    for worker in p:
        worker.join()

if __name__==  "__main__":
    test_image_preprocess()
    r.delete("image_queue")