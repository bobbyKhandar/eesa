# import database.logging as log
# import constants
# test = log.logger("test")
# # test.logGlobalEvent(log.models.EventContext(
# #     request_id="1",
# #     event_id="1",
# #     severity=constants.Severity.INFO,
# #     timestamp="2023-01-01T00:00:00Z",
# #     message="Test message",
# # ))
# # test.logGlobalEvent(log.models.EventContext(
# #     request_id="1",
# #     event_id="2",
# #     severity=constants.Severity.ERROR,
# #     timestamp="2023-01-01T00:00:01Z",
# #     message="Test error message",
# #     context={"error": "value"}
# # ))

# # test.logRequestMeta(log.models.RequestMeta(
# #     request_id="1", 
# #     log_location=constants.fileLocation.LOCAL,
# #     status=constants.JobStatus.QUEUED, 
# #     created_at="2023-01-01T00:00:00Z",
# #     last_updated="2023-01-01T00:00:00Z",
# #     resource_level=constants.resource_level.LOW,
# #     debug=True
# # ))
# # test.logRequestEvent(log.models.EventContext(
# #     event_id="1",
# #     severity=constants.Severity.INFO,
# #     timestamp="2023-01-01T00:00:02Z",
# #     message="Request event message",
# #     context={"info": "value"}
# # ))
# print(test.fetchAllInstanceLogs("test"))
# print(test.fetchAllGlobalLogs())
# print(test.fetchAllRequestMeta())