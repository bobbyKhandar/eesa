class jobHandler:
    def __init__(self,imageProcessingQueue,ocrTaskQueue):
        self.imagePreprocesser=OcrPipeline.PreProcessImage()
        self.ocrEngine=OcrPipeline.ocr()
        self.ocrWorker=multiprocessing.Process()
        self.imagePreprocesserWorker=multiprocessing.Process()
        self.imageProcessingQueue=imageProcessingQueue
        self.ocrTaskQueue=ocrTaskQueue

    def start(self,pdfFilePaths):
        numCpuCores=os.cpu_count()-2
        #todo log the cpu cores found
    
    def processOcr(self):
        while True:
            try:
                if (task:=self.ocrTaskQueue.get()) is None:
                    break#Log thsi too
                task["status"]="processingByOcr"
                result=self.ocrEngine(task["image"])
                if task["image"]
            except Exception as e:
                #Log e
                
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
    