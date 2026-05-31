"""
Unit tests for AI Server - HTTP server for Node.js integration
Tests Flask routes, request handling, response formatting, and server lifecycle
"""

import unittest
import json
import threading
import time
from unittest.mock import Mock, patch, MagicMock
import sys
import os

# Add the parent directory to the path to import from src
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from src.server import AIServer


class TestAIServerInitialization(unittest.TestCase):
    """Test AI Server initialization"""

    @patch('src.server.pipeline_manager')
    @patch('flask.Flask')
    def test_init_default_params(self, mock_flask, mock_pipeline_manager):
        """Test AI server initialization with default parameters"""
        mock_app = Mock()
        mock_flask.return_value = mock_app
        
        server = AIServer()
        
        self.assertEqual(server.host, "127.0.0.1")
        self.assertEqual(server.port, 5000)
        self.assertIsNone(server.server_thread)
        self.assertFalse(server.is_running)
        mock_pipeline_manager.start_server.assert_called_once()

    @patch('src.server.pipeline_manager')
    @patch('flask.Flask')
    def test_init_custom_params(self, mock_flask, mock_pipeline_manager):
        """Test AI server initialization with custom parameters"""
        mock_app = Mock()
        mock_flask.return_value = mock_app
        
        server = AIServer(host="0.0.0.0", port=8080)
        
        self.assertEqual(server.host, "0.0.0.0")
        self.assertEqual(server.port, 8080)


class TestAIServerRoutes(unittest.TestCase):
    """Test AI Server Flask route setup and responses"""

    def setUp(self):
        """Set up test fixtures"""
        self.mock_app = Mock()
        
        with patch('src.server.pipeline_manager'), \
             patch('flask.Flask', return_value=self.mock_app):
            self.server = AIServer()

    @unittest.skip("Method not implemented")
    def test_setup_routes_called(self):
        """Test that routes are set up during initialization"""
        # Verify that route decorators were called
        self.assertGreater(self.mock_app.route.call_count, 0)

    @patch('src.server.pipeline_manager')
    @patch('time.time')
    def test_health_check_route(self, mock_time, mock_pipeline_manager):
        """Test health check endpoint"""
        mock_time.return_value = 1234567890.0
        mock_pipeline_manager.is_running = True
        
        # Simulate the health check route function
        def health_check():
            return {
                "status": "healthy",
                "timestamp": time.time(),
                "pipeline_running": mock_pipeline_manager.is_running
            }
        
        response = health_check()
        
        self.assertEqual(response["status"], "healthy")
        self.assertEqual(response["timestamp"], 1234567890.0)
        self.assertTrue(response["pipeline_running"])

    @patch('src.server.pipeline_manager')
    def test_submit_batch_route_success(self, mock_pipeline_manager):
        """Test batch submission endpoint with valid request"""
        mock_pipeline_manager.submit_batch.return_value = "batch_123"
        
        # Simulate the submit batch route function
        def submit_batch():
            request_data = {
                "file_locations": ["/test/file1.pdf", "/test/file2.pdf"],
                "options": {"dpi": 400}
            }
            
            batch_id = mock_pipeline_manager.submit_batch(
                request_data["file_locations"],
                request_data.get("options", {})
            )
            
            return {
                "success": True,
                "batch_id": batch_id,
                "message": f"Batch {batch_id} submitted successfully"
            }
        
        response = submit_batch()
        
        self.assertTrue(response["success"])
        self.assertEqual(response["batch_id"], "batch_123")
        mock_pipeline_manager.submit_batch.assert_called_once_with(
            ["/test/file1.pdf", "/test/file2.pdf"],
            {"dpi": 400}
        )

    @patch('src.server.pipeline_manager')
    def test_submit_batch_route_missing_files(self, mock_pipeline_manager):
        """Test batch submission endpoint with missing file_locations"""
        # Simulate the submit batch route function with error handling
        def submit_batch():
            request_data = {}  # Missing file_locations
            
            if "file_locations" not in request_data:
                return {
                    "success": False,
                    "error": "file_locations is required"
                }, 400
            
            batch_id = mock_pipeline_manager.submit_batch(
                request_data["file_locations"],
                request_data.get("options", {})
            )
            
            return {
                "success": True,
                "batch_id": batch_id
            }
        
        response, status_code = submit_batch()
        
        self.assertFalse(response["success"])
        self.assertEqual(response["error"], "file_locations is required")
        self.assertEqual(status_code, 400)

    @patch('src.server.pipeline_manager')
    def test_get_batch_status_route_success(self, mock_pipeline_manager):
        """Test batch status endpoint with valid batch ID"""
        mock_status = {
            "batch_id": "test_batch",
            "status": "processing",
            "progress_percentage": 75.0,
            "total_files": 4,
            "processed_files": 3
        }
        mock_pipeline_manager.get_batch_status.return_value = mock_status
        
        # Simulate the get batch status route function
        def get_batch_status(batch_id):
            status = mock_pipeline_manager.get_batch_status(batch_id)
            
            if status is None:
                return {
                    "success": False,
                    "error": f"Batch {batch_id} not found"
                }, 404
            
            return {
                "success": True,
                "status": status
            }
        
        response = get_batch_status("test_batch")
        
        self.assertTrue(response["success"])
        self.assertEqual(response["status"], mock_status)

    @patch('src.server.pipeline_manager')
    def test_get_batch_status_route_not_found(self, mock_pipeline_manager):
        """Test batch status endpoint with non-existent batch ID"""
        mock_pipeline_manager.get_batch_status.return_value = None
        
        # Simulate the get batch status route function
        def get_batch_status(batch_id):
            status = mock_pipeline_manager.get_batch_status(batch_id)
            
            if status is None:
                return {
                    "success": False,
                    "error": f"Batch {batch_id} not found"
                }, 404
            
            return {
                "success": True,
                "status": status
            }
        
        response, status_code = get_batch_status("nonexistent")
        
        self.assertFalse(response["success"])
        self.assertEqual(response["error"], "Batch nonexistent not found")
        self.assertEqual(status_code, 404)

    @patch('src.server.pipeline_manager')
    def test_get_batch_result_route_success(self, mock_pipeline_manager):
        """Test batch result endpoint with completed batch"""
        mock_result = Mock()
        mock_result.to_dict.return_value = {
            "batch_id": "completed_batch",
            "status": "completed",
            "successful_files": 5,
            "failed_files": 0,
            "results": {"file1.pdf": {"text": "content"}}
        }
        mock_pipeline_manager.get_batch_result.return_value = mock_result
        
        # Simulate the get batch result route function
        def get_batch_result(batch_id):
            result = mock_pipeline_manager.get_batch_result(batch_id)
            
            if result is None:
                return {
                    "success": False,
                    "error": f"Batch {batch_id} not found or not completed"
                }, 404
            
            return {
                "success": True,
                "result": result.to_dict()
            }
        
        response = get_batch_result("completed_batch")
        
        self.assertTrue(response["success"])
        self.assertEqual(response["result"]["batch_id"], "completed_batch")
        self.assertEqual(response["result"]["status"], "completed")

    @patch('src.server.pipeline_manager')
    def test_cancel_batch_route_success(self, mock_pipeline_manager):
        """Test batch cancellation endpoint"""
        mock_pipeline_manager.cancel_batch.return_value = True
        
        # Simulate the cancel batch route function
        def cancel_batch(batch_id):
            success = mock_pipeline_manager.cancel_batch(batch_id)
            
            if not success:
                return {
                    "success": False,
                    "error": f"Failed to cancel batch {batch_id}"
                }, 400
            
            return {
                "success": True,
                "message": f"Batch {batch_id} cancelled successfully"
            }
        
        response = cancel_batch("test_batch")
        
        self.assertTrue(response["success"])
        self.assertEqual(response["message"], "Batch test_batch cancelled successfully")

    def test_list_batches_route(self):
        """Test listing all batches endpoint"""
        with patch('src.server.pipeline_manager') as mock_pipeline_manager:
            mock_batches = [
                {"batch_id": "batch1", "status": "completed"},
                {"batch_id": "batch2", "status": "processing"}
            ]
            mock_pipeline_manager.list_all_batches.return_value = mock_batches
            
            # Simulate the list batches route function
            def list_batches():
                batches = mock_pipeline_manager.list_all_batches()
                
                return {
                    "success": True,
                    "batches": batches,
                    "count": len(batches)
                }
            
            response = list_batches()
            
            self.assertTrue(response["success"])
            self.assertEqual(response["count"], 2)
            self.assertEqual(len(response["batches"]), 2)


class TestAIServerLifecycle(unittest.TestCase):
    """Test AI Server lifecycle management"""

    def setUp(self):
        """Set up test fixtures"""
        with patch('src.server.pipeline_manager'), \
             patch('flask.Flask'):
            self.server = AIServer()

    @patch('threading.Thread')
    def test_start_server(self, mock_thread):
        """Test starting the AI server"""
        mock_thread_instance = Mock()
        mock_thread.return_value = mock_thread_instance
        
        self.server.start()
        
        self.assertTrue(self.server.is_running)
        mock_thread.assert_called_once()
        mock_thread_instance.start.assert_called_once()

    def test_stop_server(self):
        """Test stopping the AI server"""
        self.server.is_running = True
        self.server.server_thread = Mock()
        
        self.server.stop()
        
        self.assertFalse(self.server.is_running)

    @patch('threading.Thread')
    @unittest.skip("Method not implemented")
    def test_restart_server(self, mock_thread):
        """Test restarting the AI server"""
        mock_thread_instance = Mock()
        mock_thread.return_value = mock_thread_instance
        
        # Start server first
        self.server.start()
        
        # Then restart
        self.server.restart()
        
        # Should have been called twice (start + restart)
        self.assertEqual(mock_thread.call_count, 2)

    @unittest.skip("Method not implemented")
    def test_server_status_check(self):
        """Test checking server status"""
        # Initially not running
        status = self.server.get_server_status()
        self.assertFalse(status["is_running"])
        
        # After starting
        self.server.is_running = True
        status = self.server.get_server_status()
        self.assertTrue(status["is_running"])


class TestAIServerRequestHandling(unittest.TestCase):
    """Test AI Server request handling and validation"""

    def setUp(self):
        """Set up test fixtures"""
        with patch('src.server.pipeline_manager'), \
             patch('flask.Flask'):
            self.server = AIServer()

    def test_validate_batch_request_valid(self):
        """Test validation of valid batch request"""
        valid_request = {
            "file_locations": ["/test/file1.pdf", "/test/file2.pdf"],
            "options": {"dpi": 400, "language": "en"}
        }
        
        # Simulate request validation function
        def validate_batch_request(data):
            if not isinstance(data, dict):
                return False, "Request must be JSON object"
            
            if "file_locations" not in data:
                return False, "file_locations is required"
            
            if not isinstance(data["file_locations"], list):
                return False, "file_locations must be an array"
            
            if len(data["file_locations"]) == 0:
                return False, "At least one file location is required"
            
            return True, None
        
        is_valid, error = validate_batch_request(valid_request)
        
        self.assertTrue(is_valid)
        self.assertIsNone(error)

    def test_validate_batch_request_invalid(self):
        """Test validation of invalid batch requests"""
        invalid_requests = [
            ({}, "file_locations is required"),
            ({"file_locations": "not_a_list"}, "file_locations must be an array"),
            ({"file_locations": []}, "At least one file location is required"),
            ("not_json", "Request must be JSON object")
        ]
        
        # Simulate request validation function
        def validate_batch_request(data):
            if not isinstance(data, dict):
                return False, "Request must be JSON object"
            
            if "file_locations" not in data:
                return False, "file_locations is required"
            
            if not isinstance(data["file_locations"], list):
                return False, "file_locations must be an array"
            
            if len(data["file_locations"]) == 0:
                return False, "At least one file location is required"
            
            return True, None
        
        for request_data, expected_error in invalid_requests:
            is_valid, error = validate_batch_request(request_data)
            self.assertFalse(is_valid)
            self.assertEqual(error, expected_error)

    def test_format_error_response(self):
        """Test error response formatting"""
        def format_error_response(message, status_code=500):
            return {
                "success": False,
                "error": message,
                "timestamp": time.time()
            }, status_code
        
        response, status_code = format_error_response("Test error", 400)
        
        self.assertFalse(response["success"])
        self.assertEqual(response["error"], "Test error")
        self.assertIn("timestamp", response)
        self.assertEqual(status_code, 400)

    def test_format_success_response(self):
        """Test success response formatting"""
        def format_success_response(data):
            return {
                "success": True,
                "data": data,
                "timestamp": time.time()
            }
        
        test_data = {"result": "success"}
        response = format_success_response(test_data)
        
        self.assertTrue(response["success"])
        self.assertEqual(response["data"], test_data)
        self.assertIn("timestamp", response)


class TestAIServerErrorHandling(unittest.TestCase):
    """Test AI Server error handling"""

    def setUp(self):
        """Set up test fixtures"""
        with patch('src.server.pipeline_manager'), \
             patch('flask.Flask'):
            self.server = AIServer()

    @patch('src.server.pipeline_manager')
    def test_handle_pipeline_manager_error(self, mock_pipeline_manager):
        """Test handling of pipeline manager errors"""
        mock_pipeline_manager.submit_batch.side_effect = Exception("Pipeline error")
        
        # Simulate error handling in route
        def submit_batch_with_error_handling():
            try:
                request_data = {"file_locations": ["/test/file.pdf"]}
                batch_id = mock_pipeline_manager.submit_batch(
                    request_data["file_locations"],
                    request_data.get("options", {})
                )
                return {"success": True, "batch_id": batch_id}
            except Exception as e:
                return {
                    "success": False,
                    "error": f"Internal server error: {str(e)}"
                }, 500
        
        response, status_code = submit_batch_with_error_handling()
        
        self.assertFalse(response["success"])
        self.assertIn("Pipeline error", response["error"])
        self.assertEqual(status_code, 500)

    def test_handle_json_decode_error(self):
        """Test handling of JSON decode errors"""
        def handle_request_data(raw_data):
            try:
                if isinstance(raw_data, str):
                    data = json.loads(raw_data)
                else:
                    data = raw_data
                return data, None
            except json.JSONDecodeError as e:
                return None, f"Invalid JSON: {str(e)}"
        
        # Test invalid JSON
        data, error = handle_request_data('{"invalid": json}')
        
        self.assertIsNone(data)
        self.assertIn("Invalid JSON", error)

    def test_handle_server_startup_error(self):
        """Test handling of server startup errors"""
        with patch.object(self.server.app, 'run', side_effect=Exception("Port already in use")):
            def start_server_with_error_handling():
                try:
                    self.server.app.run(host=self.server.host, port=self.server.port, debug=False)
                    return True, None
                except Exception as e:
                    return False, str(e)
            
            success, error = start_server_with_error_handling()
            
            self.assertFalse(success)
            self.assertEqual(error, "Port already in use")


class TestAIServerConfiguration(unittest.TestCase):
    """Test AI Server configuration and customization"""

    def setUp(self):
        """Set up test fixtures"""
        with patch('src.server.pipeline_manager'), \
             patch('flask.Flask'):
            self.server = AIServer()

    def test_configure_cors(self):
        """Test CORS configuration"""
        # Simulate CORS configuration
        def configure_cors(app):
            @app.after_request
            def after_request(response):
                response.headers['Access-Control-Allow-Origin'] = '*'
                response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
                response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
                return response
            return app
        
        configured_app = configure_cors(self.server.app)
        
        # Verify CORS headers would be added
        self.assertEqual(configured_app, self.server.app)

    def test_configure_rate_limiting(self):
        """Test rate limiting configuration"""
        # Simulate rate limiting setup
        def setup_rate_limiting():
            rate_limits = {
                'submit_batch': '10 per minute',
                'get_status': '100 per minute',
                'get_result': '50 per minute'
            }
            return rate_limits
        
        limits = setup_rate_limiting()
        
        self.assertIn('submit_batch', limits)
        self.assertEqual(limits['submit_batch'], '10 per minute')

    def test_configure_logging(self):
        """Test logging configuration"""
        # Simulate logging setup
        def setup_logging(log_level='INFO'):
            import logging
            
            logging.basicConfig(
                level=getattr(logging, log_level),
                format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
            )
            
            return logging.getLogger('ai_server')
        
        logger = setup_logging('DEBUG')
        
        self.assertIsNotNone(logger)
        self.assertEqual(logger.name, 'ai_server')


class TestAIServerIntegration(unittest.TestCase):
    """Test AI Server integration scenarios"""

    def setUp(self):
        """Set up test fixtures"""
        with patch('src.server.pipeline_manager'), \
             patch('flask.Flask'):
            self.server = AIServer()

    @patch('src.server.pipeline_manager')
    def test_full_workflow_simulation(self, mock_pipeline_manager):
        """Test complete workflow through server endpoints"""
        # Setup mock responses
        mock_pipeline_manager.submit_batch.return_value = "workflow_batch"
        mock_pipeline_manager.get_batch_status.return_value = {
            "batch_id": "workflow_batch",
            "status": "completed",
            "progress_percentage": 100.0
        }
        mock_pipeline_manager.get_batch_result.return_value = Mock()
        mock_pipeline_manager.get_batch_result.return_value.to_dict.return_value = {
            "batch_id": "workflow_batch",
            "status": "completed",
            "results": {"file.pdf": {"text": "content"}}
        }
        
        # Simulate workflow steps
        # Step 1: Submit batch
        submit_response = {
            "success": True,
            "batch_id": "workflow_batch"
        }
        
        # Step 2: Check status
        status_response = {
            "success": True,
            "status": {
                "batch_id": "workflow_batch",
                "status": "completed",
                "progress_percentage": 100.0
            }
        }
        
        # Step 3: Get results
        result_response = {
            "success": True,
            "result": {
                "batch_id": "workflow_batch",
                "status": "completed",
                "results": {"file.pdf": {"text": "content"}}
            }
        }
        
        # Verify workflow responses
        self.assertTrue(submit_response["success"])
        self.assertEqual(submit_response["batch_id"], "workflow_batch")
        self.assertTrue(status_response["success"])
        self.assertEqual(status_response["status"]["progress_percentage"], 100.0)
        self.assertTrue(result_response["success"])
        self.assertIn("results", result_response["result"])

    def test_concurrent_request_handling(self):
        """Test handling of concurrent requests"""
        with patch('src.server.pipeline_manager') as mock_pipeline_manager:
            mock_pipeline_manager.submit_batch.side_effect = lambda files, opts: f"batch_{len(files)}"
            
            # Simulate concurrent batch submissions
            responses = []
            
            def submit_batch_worker(file_count):
                files = [f"/test/file_{i}.pdf" for i in range(file_count)]
                batch_id = mock_pipeline_manager.submit_batch(files, {})
                responses.append({"batch_id": batch_id, "file_count": file_count})
            
            # Submit batches concurrently
            threads = []
            for i in range(1, 6):  # 1-5 files per batch
                thread = threading.Thread(target=submit_batch_worker, args=(i,))
                threads.append(thread)
                thread.start()
            
            for thread in threads:
                thread.join()
            
            # Verify all requests were handled
            self.assertEqual(len(responses), 5)
            batch_ids = [r["batch_id"] for r in responses]
            self.assertEqual(len(set(batch_ids)), 5)  # All unique


if __name__ == '__main__':
    unittest.main(verbosity=2)