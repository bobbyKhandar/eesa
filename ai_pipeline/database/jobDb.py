#local text based database for job information and Atomicity in case of failures
import sqlite3
import constants
import os
import uuid

class database:
    def __init__(self,request_id:str):
        self.dbPath=os.getcwd()+"/ocr/"+request_id+".db"
        conn=sqlite3.connect(self.dbPath)
        c=conn.cursor()
        c.execute(f'''CREATE TABLE IF NOT EXISTS jobs
                 (id TEXT PRIMARY KEY,
                  file_path TEXT NOT NULL,
                  status TEXT default {constants.JobStatus.QUEUED},
                  retries INTEGER default 0,
                  confidence REAL default NULL,
                  text TEXT default NULL,
                  error_message TEXT default NULL
              )''')
        conn.commit()
        conn.close()
        self.request_id=request_id
    
    def updateJobStatus(self,jobstatus:constants.JobStatus,jobId:str):
        conn=sqlite3.connect(self.dbPath)
        c=conn.cursor()
        c.execute('''UPDATE jobs SET status=? WHERE id=?''',
                  (jobstatus, jobId))
        conn.commit()
        conn.close()
    
    def updateJobError(self,jobId:str,errorMsg:str):
        conn=sqlite3.connect(self.dbPath)
        c=conn.cursor()
        c.execute('''UPDATE jobs SET status=?, errorMsg=? WHERE id=?''',
                  (constants.JobStatus.FAILED, errorMsg, jobId))
        conn.commit()
        conn.close()
    
    def updateJobResult(self,jobId:str,confidence:float,text:str):
        conn=sqlite3.connect(self.dbPath)
        c=conn.cursor()
        c.execute('''UPDATE jobs SET status=?, confidence=?, text=? WHERE id=?''',
                  (constants.JobStatus.COMPLETE, confidence, text, jobId))
        conn.commit()
        conn.close()
    
    def insertSingleJob(self,file_path:str):
        conn=sqlite3.connect(self.dbPath)
        id=str(uuid.uuid4())
        c=conn.cursor()
        c.execute('''INSERT INTO jobs (id,file_path) VALUES (?,?)''',
                  (id,file_path))
        conn.commit()
        conn.close()
        
    def insertMultipleJobs(self,jobList:list):
        conn=sqlite3.connect(self.dbPath)
        c=conn.cursor()
        c.executemany('''INSERT INTO jobs (id,file_path) VALUES (?,?)''', jobList)
        conn.commit()
        conn.close()
    
    def getNextPendingJob(self):
        conn=sqlite3.connect(self.dbPath)
        c=conn.cursor()
        c.execute('''UPDATE jobs set status=? WHERE status=? LIMIT 1 RETURNING *''', (constants.JobStatus.QUEUED,constants.JobStatus.SCANNING))
        job = c.fetchone()
        conn.close()
        if job:
            return {"id": job[0], "file_path": job[1]}
        else:
            return None
    
    def getNextFailedJob(self,retries=3):
        conn=sqlite3.connect(self.dbPath)
        c=conn.cursor()
        c.execute('''UPDATE jobs set retries = retries+1 WHERE status=? AND retries < ? LIMIT 1 RETURNING *''', (constants.JobStatus.FAILED,retries))
        job = c.fetchone()
        conn.close()
        if job:
            return {"id": job[0], "file_path": job[1]}
        else:
            return None
    
    def getPendingJobCount(self):
        conn=sqlite3.connect(self.dbPath)
        c=conn.cursor()
        c.execute('''SELECT COUNT(*) FROM jobs WHERE status=?''', (constants.JobStatus.QUEUED,))
        count = c.fetchone()[0]
        conn.close()
        return count

class jobDb:
    def __init__(self,request_id:str):
        self.dbPath=os.getcwd()+"/ocr/"+request_id+".db"
        conn=sqlite3.connect(self.dbPath)
        c=conn.cursor()
        c.execute(f'''
                  create table if not exists jobs
                  (id TEXT PRIMARY KEY,
                    file_path TEXT NOT NULL,
                    status TEXT default {constants.JobStatus.QUEUED},
              )''')
        conn.commit()
        conn.close()
        self.request_id=request_id