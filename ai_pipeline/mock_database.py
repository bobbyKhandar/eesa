"""
Mock database for OCR pipeline testing
"""

class jobDatabase:
    def __init__(self, session_id):
        self.session_id = session_id
        self.jobs = []
        self.pending_jobs = []
        self.completed_jobs = []
        self.failed_jobs = []
        print(f"Mock Database initialized with session: {session_id}")
        
    def insertMultipleJobs(self, jobs):
        """Insert multiple jobs into the database"""
        for job in jobs:
            job['id'] = job.get('jobId', 'unknown')
            job['status'] = 'pending'
            self.jobs.append(job)
            self.pending_jobs.append(job)
        print(f"Mock DB: Inserted {len(jobs)} jobs")
        
    def getPendingJobCount(self):
        """Get count of pending jobs"""
        count = len(self.pending_jobs)
        print(f"Mock DB: {count} pending jobs")
        return count
        
    def getNextPendingJob(self):
        """Get the next pending job"""
        if self.pending_jobs:
            job = self.pending_jobs.pop(0)
            print(f"Mock DB: Retrieved pending job {job.get('id', 'unknown')}")
            return job
        return None
        
    def getNextFailedJob(self, retries=3):
        """Get the next failed job for retry"""
        if self.failed_jobs:
            job = self.failed_jobs.pop(0)
            print(f"Mock DB: Retrieved failed job {job.get('id', 'unknown')} for retry")
            return job
        return None
        
    def updateJobResult(self, job_id, confidence, text):
        """Update job with successful result"""
        print(f"Mock DB: Job {job_id} completed successfully")
        print(f"  - Confidence: {confidence:.2f}")
        print(f"  - Text length: {len(text)} characters")
        
        # Move to completed jobs
        for job in self.jobs:
            if job.get('id') == job_id or job.get('jobId') == job_id:
                job['status'] = 'completed'
                job['confidence'] = confidence
                job['text'] = text
                self.completed_jobs.append(job)
                break
                
    def updateJobError(self, job_id, error):
        """Update job with error"""
        print(f"Mock DB: Job {job_id} failed with error: {error}")
        
        # Move to failed jobs
        for job in self.jobs:
            if job.get('id') == job_id or job.get('jobId') == job_id:
                job['status'] = 'failed'
                job['error'] = error
                self.failed_jobs.append(job)
                break