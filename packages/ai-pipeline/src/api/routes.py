"""Flask route handlers for the AI Pipeline API."""

import time
from flask import request, jsonify

from .aws_manager import AWSPipelineManager


def register_routes(app, aws_manager, pipeline_manager):
    @app.route('/health', methods=['GET'])
    def health_check():
        return jsonify({
            "status": "healthy",
            "timestamp": time.time(),
            "local_pipeline": pipeline_manager.is_running if pipeline_manager else False,
            "aws_pipeline": True
        })

    # --- LOCAL PIPELINE ROUTES ---
    def _submit_local_batch():
        if not pipeline_manager:
            return jsonify({"error": "Local pipeline not initialized"}), 501
        try:
            data = request.get_json()
            file_locations = data.get('file_locations', [])
            options = data.get('options', {})
            batch_id = pipeline_manager.submit_batch(file_locations, options)
            return jsonify({"success": True, "batch_id": batch_id})
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route('/submit-local', methods=['POST'])
    def submit_batch_local():
        return _submit_local_batch()

    @app.route('/submit', methods=['POST'])
    def submit_batch_legacy():
        return _submit_local_batch()

    # --- AWS PIPELINE ROUTES ---
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
    def get_aws_job_status(job_id):
        status = aws_manager.get_job_status(job_id)
        if not status:
            return jsonify({"error": "Job not found"}), 404
        return jsonify({"success": True, "job": status})

    # --- SHARED/LEGACY ROUTES ---
    @app.route('/status/<batch_id>', methods=['GET'])
    def get_local_batch_status(batch_id):
        if not pipeline_manager:
            return jsonify({"error": "Local pipeline not initialized"}), 501
        status = pipeline_manager.get_batch_status(batch_id)
        if status is None:
            return jsonify({"error": "Batch not found"}), 404
        return jsonify({"success": True, "status": status})

    @app.route('/result/<batch_id>', methods=['GET'])
    def get_local_batch_result(batch_id):
        if not pipeline_manager:
            return jsonify({"error": "Local pipeline not initialized"}), 501
        result = pipeline_manager.get_batch_result(batch_id)
        if result is None:
            return jsonify({"error": "Batch not found"}), 404
        return jsonify({"success": True, "result": result.to_dict()})
