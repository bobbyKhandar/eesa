from cmath import sqrt
from datetime import datetime, time
import os
import sqlite3
import uuid
from log import models,upload
from threading import Thread
import constants

class logger:
    def __init__(self,request_id:str):
        try:
            self.logfile="logs.sqlite"
            self.request_id=request_id
            conn=sqlite3.connect(self.logfile)  
            c=conn.cursor()
            c.execute('''CREATE TABLE IF NOT EXISTS request_meta ( request_id TEXT PRIMARY KEY ,
                      log_location TEXT CHECK(log_location IN ('local', 'cloud')),created_at TEXT, completed_at TEXT,
                      last_updated TEXT, status TEXT CHECK(status IN ('queued', 'scanning', 'complete','failed')), 
                      resource_level TEXT CHECK(resource_level IN ('low', 'medium', 'high')),debug boolean )''')
            
            c.execute('''CREATE TABLE IF NOT EXISTS global_log ( event_id TEXT, request_id TEXT default NULL
                      ,severity Text CHECK(severity IN('DEBUG',"INFO","WARNING","ERROR","CRITICAL")), timestamp TEXT, message TEXT, context TEXT )''')
            conn.commit()
            conn.close()   
            conn2=sqlite3.connect(request_id+".sqlite")
            c2=conn2.cursor()
            c2.execute('''CREATE TABLE IF NOT EXISTS instance_log (event_id TEXT PRIMARY KEY,severity Text CHECK(severity IN ('DEBUG','INFO','WARNING','ERROR','CRITICAL')), 
                       timestamp TEXT, message TEXT, context TEXT )'''
                       )
            conn2.commit()
            conn2.close() 
        
        except Exception as e:
            raise e
        
    def logGlobalEvent(self,logEvent:models.EventContext):
        conn=sqlite3.connect(self.logfile)  
        c=conn.cursor()
        c.execute('''INSERT INTO global_log (event_id,request_id,severity,timestamp,message,context) VALUES (?,?,?,?,?,?)''',
                  (uuid.uuid4().hex,logEvent.request_id,logEvent.severity.value,datetime.now().isoformat(),logEvent.message,str(logEvent.context)))
        conn.commit()
        conn.close()
        print(f"[INFO] Logged global event: {logEvent.event_id}")
        size=self.checkDatabaseSize(self.logfile)
        

    def logRequestEvent(self,logEvent:models.EventContext):
        conn=sqlite3.connect(self.request_id+".sqlite")  
        c=conn.cursor()
        c.execute('''INSERT INTO instance_log (event_id,severity,timestamp,message,context) VALUES (?,?,?,?,?)''',
                  (uuid.uuid4().hex,logEvent.severity.value,datetime.now().isoformat(),logEvent.message,str(logEvent.context)))
        conn.commit()
        conn.close()

    def logRequestMeta(self,requestMeta:models.RequestMeta):
        conn=sqlite3.connect(self.logfile)  
        c=conn.cursor()
        request_id=uuid.uuid4().hex 
        c.execute('''INSERT INTO request_meta (request_id,log_location,created_at,completed_at,last_updated,status,resource_level,debug) VALUES (?,?,?,?,?,?,?,?)''',
                  (request_id,requestMeta.log_location.value,requestMeta.created_at,requestMeta.completed_at,requestMeta.last_updated,requestMeta.status,requestMeta.resource_level.value,requestMeta.debug))
        conn.commit()
        conn.close()
        self.request_id=request_id
        return {"status":"success","message":"Logged request meta successfully"}
    
    def fetchAllRequestMeta(self)->list[models.RequestMeta]:
        conn=sqlite3.connect(self.logfile)  
        c=conn.cursor()
        c.execute('''SELECT * FROM request_meta''')
        rows=c.fetchall()
        conn.close()
        return [models.RequestMeta(
            request_id=row[0],
            log_location=row[1],
            created_at=row[2],
            completed_at=row[3],
            last_updated=row[4],
            status=row[5],
            resource_level=row[6],
            debug=bool(row[7])
        ) for row in rows]
    
    def fetchAllGlobalLogs(self)->list[models.EventContext]:
        conn=sqlite3.connect(self.logfile)  
        c=conn.cursor()
        c.execute('''SELECT * FROM global_log''')
        rows=c.fetchall()
        conn.close()
        return [models.EventContext(
            event_id=row[0],
            request_id=row[1],
            severity=row[2],
            timestamp=row[3],
            message=row[4],
            context=eval(row[5]) if row[5] else None
        ) for row in rows]
    
    def fetchAllInstanceLogs(self,request_id:str)->list[models.EventContext]:
        conn=sqlite3.connect(request_id+".sqlite")  
        c=conn.cursor()
        c.execute('''SELECT * FROM instance_log''')
        rows=c.fetchall()
        conn.close()
        return [models.EventContext(
            event_id=row[0],
            request_id=None,
            severity=row[1],
            timestamp=row[2],
            message=row[3],
            context=eval(row[4]) if row[4] else None
        ) for row in rows]
    
    #returns size in MB
    def checkDatabaseSize(self)->int:
        if 1024*1024*os.path.getsize(self.logfile)/(1024*1024) > 1.00:
            print("[INFO] Log database size exceeded 1MB,Uploading logfile to the database and creating a new log file")
            #upload to cloud
            cloudUploader=upload.Upload()
            Thread(target=self.retryUploadLogFile,args=(cloudUploader,self.logfile,0)).start()
            
    
    def retryUploadLogFile(self,cloudUploader:upload.Upload,filepath:str,retries:int):
        if retries<10:
            try:
                cloudUploader.uploadLogFile(self.logfile)
                #create new log file
                newLogFile=str(uuid.uuid4())
                self.logfile,newLogFile=newLogFile,self.logfile
                os.remove(newLogFile)# switched new and old log file names and deleted the true old one
            except Exception as e:
                print(f"[ERROR] Failed to upload log file: {e}")
                self.logGlobalEvent(models.EventContext(
                    event_id=str(uuid.uuid4()),
                    severity=constants.Severity.ERROR,
                    timestamp=datetime.now().isoformat(),
                    message=f"Failed to upload log file to database trying again in {sqrt(i**i)} seconds. Error of failure : {e}",
                    request_id=self.request_id
                ))
                i=retries+1
                self.retryUploadLogFile(cloudUploader,filepath,i)
        else:
            print("[CRITICAL] Failed to upload log file after 10 retries, manual intervention required")
            self.logGlobalEvent(models.EventContext(
                event_id=str(uuid.uuid4()),
                severity=constants.Severity.CRITICAL,
                timestamp=datetime.now().isoformat(),
                message=f"Failed to upload log file after 10 retries, manual intervention required",
                request_id=self.request_id
            ))
            mailService=mailer.mailer()
            mailService.sendAlert(f"Failed to upload log file to the database after 10 retries, manual intervention required","Critical: Log File Upload Failure")
        
    # def __init__(self,logfile:str):
    #     self.logfile=logfile
    #     open(self.logfile, "a").write(f"[INFO] Log started at {datetime.now()} \n")

    def info(self,message:str):
        open(self.logfile, "a").write(f"[INFO] at  {datetime.now()} : {message} \n")

    def warning(self,message:str):
        open(self.logfile, "a").write(f"[WARNING] at  {datetime.now()} : {message} \n")

    def error(self,message:str):
        open(self.logfile, "a").write(f"[ERROR] at  {datetime.now()} : {message} \n")

    def updateLogFile(self,logfile:str):
        self.logfile=logfile
        open(self.logfile, "a").write(f"[INFO] Log updated at {datetime.now()} \n")