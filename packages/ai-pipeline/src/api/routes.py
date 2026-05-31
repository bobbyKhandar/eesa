"""Flask route handlers for the AI Pipeline API."""

import os
import uuid
import time
from datetime import datetime
from flask import request, jsonify

from .question_retriever import get_job_questions


def register_routes(app, aws_manager, pipeline_manager):
    # ------------------------------------------------------------------
    # Health
    # ------------------------------------------------------------------
    @app.route('/health', methods=['GET'])
    def health_check():
        local_status = False
        try:
            if pipeline_manager:
                local_status = getattr(pipeline_manager, 'is_running', False)
        except Exception:
            pass
        return jsonify({
            'status': 'healthy',
            'service': 'AI Pipeline Server',
            'timestamp': datetime.now().isoformat(),
            'local_pipeline': local_status,
            'aws_pipeline': aws_manager.is_aws_available()
        })

    # ------------------------------------------------------------------
    # AWS Pipeline Routes (Production)
    # ------------------------------------------------------------------
    @app.route('/process', methods=['POST'])
    def process_single_aws_job():
        if not aws_manager.is_aws_available():
            return jsonify({'error': 'AWS pipeline not configured'}), 503
        try:
            data = request.json
            if not data.get('s3_key'):
                return jsonify({'error': 'Missing s3_key'}), 400
            s3_key = data['s3_key']
            s3_bucket = data.get('s3_bucket', aws_manager.s3_bucket)
            job_id = data.get('job_id') or str(uuid.uuid4())
            filename = data.get('filename') or os.path.basename(s3_key)
            try:
                aws_manager.s3_client.head_object(Bucket=s3_bucket, Key=s3_key)
            except Exception:
                return jsonify({'error': f'File not found in S3: {s3_key}'}), 404
            aws_manager.executor.submit(aws_manager.process_aws_job_pipeline, job_id, s3_key, filename)
            return jsonify({
                'job_id': job_id,
                'status': 'processing',
                'message': 'AWS job started successfully',
                's3_key': s3_key,
                'filename': filename
            }), 202
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    @app.route('/process/batch', methods=['POST'])
    def process_batch_aws_jobs():
        if not aws_manager.is_aws_available():
            return jsonify({'error': 'AWS pipeline not configured'}), 503
        try:
            data = request.json
            if not data.get('jobs') or not isinstance(data['jobs'], list):
                return jsonify({'error': 'Missing or invalid jobs array'}), 400
            s3_bucket = data.get('s3_bucket', aws_manager.s3_bucket)
            job_submissions = []
            for job_data in data['jobs']:
                s3_key = job_data.get('s3_key')
                if not s3_key:
                    continue
                job_id = job_data.get('job_id') or str(uuid.uuid4())
                filename = job_data.get('filename') or os.path.basename(s3_key)
                job_submissions.append({'job_id': job_id, 's3_key': s3_key, 'filename': filename})
            if not job_submissions:
                return jsonify({'error': 'No valid jobs provided'}), 400
            executor = aws_manager.executor
            for job in job_submissions:
                executor.submit(aws_manager.process_aws_job_pipeline, job['job_id'], job['s3_key'], job['filename'])
            return jsonify({
                'message': f'AWS batch processing started for {len(job_submissions)} jobs',
                'jobs': [{'job_id': j['job_id'], 'filename': j['filename'], 'status': 'processing'} for j in job_submissions]
            }), 202
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    @app.route('/job/<job_id>/status', methods=['GET'])
    def get_aws_job_status(job_id):
        try:
            metadata = aws_manager.load_job_metadata(job_id)
            if not metadata:
                return jsonify({'error': 'Job not found'}), 404
            return jsonify(metadata), 200
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    @app.route('/job/<job_id>/metadata', methods=['GET'])
    def get_aws_job_metadata(job_id):
        return get_aws_job_status(job_id)

    @app.route('/job/<job_id>/questions', methods=['GET'])
    def get_job_questions_route(job_id):
        try:
            metadata = aws_manager.load_job_metadata(job_id)
            if not metadata:
                return jsonify({'error': 'Job not found'}), 404
            if metadata.get('status') != 'success':
                return jsonify({
                    'error': 'Job not completed yet',
                    'status': metadata.get('status'),
                    'message': 'Questions are only available after the job completes successfully'
                }), 400
            if not aws_manager.s3_client:
                return jsonify({'error': 'S3 not available'}), 503
            result = get_job_questions(
                aws_manager.s3_client, aws_manager.s3_bucket,
                aws_manager.s3_jobs_prefix, job_id, metadata
            )
            if not result:
                return jsonify({
                    'error': 'No questions found',
                    'message': 'The job completed but no questions were extracted'
                }), 404
            return jsonify(result), 200
        except Exception as e:
            print(f"Error loading questions: {e}")
            import traceback
            traceback.print_exc()
            return jsonify({'error': str(e)}), 500

    @app.route('/jobs/active', methods=['GET'])
    def get_active_aws_jobs():
        return jsonify({
            'count': aws_manager.get_active_jobs_count(),
            'jobs': aws_manager.get_active_jobs()
        }), 200

    # ------------------------------------------------------------------
    # Local Pipeline Routes
    # ------------------------------------------------------------------
    @app.route('/submit-local', methods=['POST'])
    def submit_local_batch():
        if not pipeline_manager:
            return jsonify({'error': 'Local pipeline not available'}), 503
        try:
            data = request.get_json()
            file_locations = data.get('file_locations', [])
            options = data.get('options', {})
            if not file_locations:
                return jsonify({'error': 'No file_locations provided'}), 400
            batch_id = pipeline_manager.submit_batch(file_locations, options)
            return jsonify({
                "success": True,
                "batch_id": batch_id,
                "message": "Local batch submitted successfully",
                "files_queued": len(file_locations)
            }), 202
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route('/submit', methods=['POST'])
    def submit_batch_legacy():
        return submit_local_batch()

    @app.route('/status/<batch_id>', methods=['GET'])
    def get_local_batch_status(batch_id):
        if not pipeline_manager:
            return jsonify({'error': 'Local pipeline not available'}), 503
        status = pipeline_manager.get_batch_status(batch_id)
        if status is None:
            return jsonify({"error": "Batch not found"}), 404
        return jsonify({"success": True, "status": status}), 200

    @app.route('/result/<batch_id>', methods=['GET'])
    def get_local_batch_result(batch_id):
        if not pipeline_manager:
            return jsonify({'error': 'Local pipeline not initialized'}), 501
        result = pipeline_manager.get_batch_result(batch_id)
        if result is None:
            return jsonify({"error": "Batch not found"}), 404
        return jsonify({"success": True, "result": result.to_dict()})

    # ------------------------------------------------------------------
    # Legacy AWS Route (submit-aws maps to submit_job)
    # ------------------------------------------------------------------
    @app.route("/submit-aws", methods=["POST"])
    def submit_batch_aws():
        try:
            data = request.get_json()
            if not data:
                return jsonify({"error": "No JSON data provided"}), 400
            bucket = data.get("bucket")
            files = data.get("files")
            job_id = data.get("job_id")
            if not bucket or not files:
                return jsonify({"error": "Missing 'bucket' or 'files' list"}), 400
            assigned_job_id = aws_manager.submit_job(bucket, files, job_id)
            return jsonify({
                "success": True, "job_id": assigned_job_id,
                "message": "AWS Batch Job submitted successfully",
                "files_queued": len(files)
            })
        except Exception as e:
            print(f"Error in submit-aws: {e}")
            return jsonify({"error": str(e)}), 500

    @app.route('/status-aws/<job_id>', methods=['GET'])
    def get_aws_job_status_legacy(job_id):
        status = aws_manager.get_job_status(job_id)
        if not status:
            return jsonify({"error": "Job not found"}), 404
        return jsonify({"success": True, "job": status})

    # ------------------------------------------------------------------
    # File Upload Routes (Frontend Integration)
    # ------------------------------------------------------------------
    @app.route('/upload/question-papers', methods=['POST'])
    def upload_question_papers():
        if not aws_manager.is_aws_available():
            return jsonify({'error': 'AWS pipeline not configured'}), 503
        try:
            if 'files' not in request.files:
                return jsonify({'error': 'No files provided'}), 400
            files = request.files.getlist('files')
            if not files or len(files) == 0:
                return jsonify({'error': 'No files selected'}), 400
            allowed_extensions = {'.pdf', '.PDF'}
            uploaded_jobs = []
            errors = []
            for file in files:
                filename = file.filename
                if not filename:
                    continue
                file_ext = os.path.splitext(filename)[1]
                if file_ext not in allowed_extensions:
                    errors.append(f"{filename}: Only PDF files are allowed")
                    continue
                try:
                    job_id = str(uuid.uuid4())
                    s3_key = f"{aws_manager.s3_jobs_prefix}{job_id}/original/{filename}"
                    file_content = file.read()
                    aws_manager.s3_client.put_object(
                        Bucket=aws_manager.s3_bucket,
                        Key=s3_key,
                        Body=file_content,
                        ContentType='application/pdf'
                    )
                    print(f"Uploaded {filename} to s3://{aws_manager.s3_bucket}/{s3_key}")
                    aws_manager.executor.submit(aws_manager.process_aws_job_pipeline, job_id, s3_key, filename)
                    uploaded_jobs.append({
                        'job_id': job_id,
                        'filename': filename,
                        's3_key': s3_key,
                        'status': 'processing'
                    })
                except Exception as e:
                    errors.append(f"{filename}: {str(e)}")
                    print(f"Failed to upload {filename}: {e}")
            response = {
                'success': len(uploaded_jobs) > 0,
                'message': f'Uploaded {len(uploaded_jobs)} files successfully',
                'jobs': uploaded_jobs
            }
            if errors:
                response['errors'] = errors
                response['message'] += f', {len(errors)} failed'
            status_code = 202 if len(uploaded_jobs) > 0 else 400
            return jsonify(response), status_code
        except Exception as e:
            print(f"Upload error: {e}")
            return jsonify({'error': str(e)}), 500
