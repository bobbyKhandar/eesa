# Redis Data Structure
# This document outlines the Redis data structures used in the AI pipeline for managing jobs, images, and metadata.
# It includes details on queues and metadata storage for efficient processing and tracking.
# The data structures are designed to facilitate the workflow of image preprocessing, OCR processing, and job management.
# Queues

# queue:preprocess
# queue:ocr
# queue:jobsMerge
# queue:final_results

# Meta
# meta:page:<pageId>
#     meta:page:<pageId> = {
#         "pdfLocation": pdfPath,
#         "pdfId": pdfId, #images from the same pdf would be merged based on their pdfId
#         "pageNo": i,
#         "status": "inImageProcessingQueue",
#         "result": "",
#         "retryCount": 0,
#         "imageData": ""
#     }   
# meta:pdf:<pdfId>
#     meta:pdf:<pdfId> = {
#         "totalPages":pageCount,
#         "processedPages":0,
#         "pagesIds":[],
#         "processedPagesIds":[],
#         "status":"inProgress",
#     }
    
# meta:job:<jobId>(jobs are given from nodejs)
#     meta:job:<jobId> = {
#         "jobId": jobId,
#         "pdfsIds":[],
#         "totalPdfs":0,
#         "pdfsLocations":[],
#         "processedPdfs":0,
#         "status":"inProgress",
#     }


class Queues:
    AI_PIPELINE_QUEUE="queue:ai:pipeline"
    IMAGE_QUEUE = "queue:image:preprocess"
    OCR_QUEUE = "queue:ocr"
    IMAGES_MERGE_QUEUE = "queue:jobsMerge"
    FINAL_RESULTS_QUEUE = "queue:final_results"
