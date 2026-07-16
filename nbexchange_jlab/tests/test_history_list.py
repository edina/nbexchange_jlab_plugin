import os

import pytest
import requests
from mock import patch
from nbgrader.auth import Authenticator
from nbgrader.coursedir import CourseDirectory
from traitlets.config.loader import LazyConfigValue

from nbexchange_jlab.history_list.handlers import HistoryError, HistoryList
from nbexchange_jlab.plugins import Exchange, ExchangeError

mocked_json_response = {
    "success": True,
    "value": [
        {
            "role": {"Instructor": 1},
            "user_id": {"13": 1},
            "assignments": [
                {
                    "assignment_id": 80,
                    "assignment_code": "test 123",
                    "actions": [
                        {
                            "action": "AssignmentActions.released",
                            "timestamp": "2022-01-17 15:51:44.809328 +0000",
                            "user": "1-kiz",
                        },
                        {
                            "action": "AssignmentActions.fetched",
                            "timestamp": "2022-01-17 15:51:52.621861 +0000",
                            "user": "1-kiz",
                        },
                        {
                            "action": "AssignmentActions.submitted",
                            "timestamp": "2022-01-17 15:53:11.064558 +0000",
                            "user": "1-kiz",
                        },
                        {
                            "action": "AssignmentActions.collected",
                            "timestamp": "2022-01-17 15:53:18.915705 +0000",
                            "user": "1-kiz",
                        },
                        {
                            "action": "AssignmentActions.feedback_released",
                            "timestamp": "2022-01-17 15:54:34.539665 +0000",
                            "user": "1-kiz",
                        },
                        {
                            "action": "AssignmentActions.feedback_fetched",
                            "timestamp": "2022-01-17 15:54:43.010072 +0000",
                            "user": "1-kiz",
                        },
                    ],
                    "action_summary": {
                        "released": 1,
                        "fetched": 1,
                        "submitted": 1,
                        "collected": 1,
                        "feedback_released": 1,
                        "feedback_fetched": 1,
                    },
                },
            ],
            "isInstructor": True,
            "course_id": 35,
            "course_code": "my_course_code",
            "course_title": "my_course_code",
        },
    ],
}


IN_GITHUB_ACTIONS = os.getenv("GITHUB_ACTIONS") == "true"


@pytest.mark.skipif(IN_GITHUB_ACTIONS, reason="Test doesn't work in Github Actions.")
@pytest.mark.gen_test
def test_load_config():

    plugin = HistoryList()

    config = plugin.load_config()

    assert config["Exchange"]["path_includes_course"] is True or isinstance(
        config["Exchange"]["path_includes_course"], LazyConfigValue
    )
    assert config["CourseDirectory"]["course_id"] == "missing" or isinstance(config["Exchange"], LazyConfigValue)


@pytest.mark.skipif(IN_GITHUB_ACTIONS, reason="Test doesn't work in Github Actions.")
@pytest.mark.gen_test
def test_yield_config():

    plugin = HistoryList()

    with plugin.yield_config() as config:
        assert config["Exchange"]["path_includes_course"] is True or isinstance(
            config["Exchange"]["path_includes_course"], LazyConfigValue
        )
        assert config["CourseDirectory"]["course_id"] == "missing" or isinstance(config["Exchange"], LazyConfigValue)


@pytest.mark.gen_test
def test_query_exchange_fail_config():

    def api_request(*args, **kwargs):
        return type(
            "Request",
            (object,),
            {
                "status_code": 200,
                "json": (
                    lambda: {
                        "success": False,
                        "value": "this is an error",
                    }
                ),
            },
        )

    plugin = HistoryList()

    with patch.object(Exchange, "api_request", side_effect=api_request):
        with pytest.raises(HistoryError) as e:
            plugin.query_exchange()
            assert e.value == "Connection to the exchange failed: 'NoneType' object has no attribute 'coursedir'"


@pytest.mark.gen_test
def test_query_exchange_fail_http_status():

    def api_request(*args, **kwargs):
        return type(
            "Request",
            (object,),
            {
                "status_code": 418,
                "reason": "I'm a teapot",
            },
        )

    plugin = HistoryList()
    config = plugin.load_config()

    coursedir = CourseDirectory(config=config)
    authenticator = Authenticator(config=config)
    plugin.exchange = Exchange(coursedir=coursedir, authenticator=authenticator, config=config)

    with patch.object(Exchange, "api_request", side_effect=api_request):
        with pytest.raises(HistoryError) as err:
            plugin.query_exchange()
        assert str(err.value) == "I'm a teapot"


@pytest.mark.gen_test
def test_query_exchange_fail_response_not_json():

    def api_request(*args, **kwargs):
        return type(
            "Request",
            (object,),
            {
                "status_code": 200,
                "text": "This is not json",
            },
        )

    plugin = HistoryList()
    config = plugin.load_config()

    coursedir = CourseDirectory(config=config)
    authenticator = Authenticator(config=config)
    plugin.exchange = Exchange(coursedir=coursedir, authenticator=authenticator, config=config)

    with patch.object(Exchange, "api_request", side_effect=api_request):
        with pytest.raises(HistoryError) as err:
            plugin.query_exchange()
        assert str(err.value) == "Got back an invalid response when history: response text: 'This is not json'"


@pytest.mark.gen_test
def test_query_exchange_fail_malformed_json():

    def api_request(*args, **kwargs):
        return type(
            "Request",
            (object,),
            {
                "status_code": 200,
                "json": lambda: {
                    "this is an error",
                },
            },
        )

    plugin = HistoryList()
    config = plugin.load_config()

    coursedir = CourseDirectory(config=config)
    authenticator = Authenticator(config=config)
    plugin.exchange = Exchange(coursedir=coursedir, authenticator=authenticator, config=config)

    with patch.object(Exchange, "api_request", side_effect=api_request):
        with pytest.raises(HistoryError) as err:
            plugin.query_exchange()
        assert str(err.value) == "Invalid response from the exchange: {'this is an error'}"


@pytest.mark.gen_test
def test_query_exchange_fail_message_in_jason():

    def api_request(*args, **kwargs):
        return type(
            "Request",
            (object,),
            {
                "status_code": 200,
                "json": (
                    lambda: {
                        "success": False,
                        "value": "this is an error",
                    }
                ),
            },
        )

    plugin = HistoryList()
    config = plugin.load_config()

    coursedir = CourseDirectory(config=config)
    authenticator = Authenticator(config=config)
    plugin.exchange = Exchange(coursedir=coursedir, authenticator=authenticator, config=config)

    with patch.object(Exchange, "api_request", side_effect=api_request):
        with pytest.raises(HistoryError) as err:
            plugin.query_exchange()
        assert str(err.value) == "Error message from exchange: 'this is an error'"


@pytest.mark.gen_test
def test_query_exchange_success(monkeypatch):

    def api_request(*args, **kwargs):
        return type(
            "Request",
            (object,),
            {
                "status_code": 200,
                "json": (lambda: mocked_json_response),
            },
        )

    plugin = HistoryList()
    config = plugin.load_config()

    coursedir = CourseDirectory(config=config)
    authenticator = Authenticator(config=config)
    plugin.exchange = Exchange(coursedir=coursedir, authenticator=authenticator, config=config)

    data = {}
    with patch.object(Exchange, "api_request", side_effect=api_request):
        data = plugin.query_exchange()
    record = data[0]
    assert list(record.keys()) == [
        "role",
        "user_id",
        "assignments",
        "isInstructor",
        "course_id",
        "course_code",
        "course_title",
        "isCurrent",
    ]
    assert list(record["assignments"][0].keys()) == ["assignment_id", "assignment_code", "actions", "action_summary"]
    assert record["isCurrent"] is False


@pytest.mark.gen_test
def test_query_exchange_success_on_current_course(monkeypatch):

    def api_request(*args, **kwargs):
        return type(
            "Request",
            (object,),
            {
                "status_code": 200,
                "json": (lambda: mocked_json_response),
            },
        )

    plugin = HistoryList()
    config = plugin.load_config()

    coursedir = CourseDirectory(config=config)
    authenticator = Authenticator(config=config)
    plugin.exchange = Exchange(coursedir=coursedir, authenticator=authenticator, config=config)
    monkeypatch.setenv("NAAS_COURSE_ID", "my_course_code")

    data = {}
    with patch.object(Exchange, "api_request", side_effect=api_request):
        data = plugin.query_exchange()
    assert data[0]["isCurrent"] is True


@pytest.mark.gen_test
def test_list_history_fail_no_course_code_env():

    plugin = HistoryList()
    data = plugin.list_history()

    assert data["success"] is False
    assert data["value"] == "You need to have a current course code."


@pytest.mark.gen_test
def test_list_history_wrong_course_code(monkeypatch):

    def api_request(*args, **kwargs):
        return type(
            "Request",
            (object,),
            {
                "status_code": 200,
                "json": (lambda: mocked_json_response),
            },
        )

    plugin = HistoryList()

    monkeypatch.setenv("NAAS_COURSE_ID", "different_course_code")

    data = {}
    with patch.object(Exchange, "api_request", side_effect=api_request):
        data = plugin.list_history()

    assert data["success"] is True
    assert data["value"][0]["isCurrent"] is False


@pytest.mark.gen_test
def test_list_history_correct_course_code(monkeypatch):

    def api_request(*args, **kwargs):
        return type(
            "Request",
            (object,),
            {
                "status_code": 200,
                "json": (lambda: mocked_json_response),
            },
        )

    plugin = HistoryList()

    monkeypatch.setenv("NAAS_COURSE_ID", "my_course_code")

    data = {}
    with patch.object(Exchange, "api_request", side_effect=api_request):
        data = plugin.list_history()

    assert data["success"] is True
    assert data["value"][0]["isCurrent"] is True


@pytest.mark.gen_test
def test_list_history_error_raised_by_query_exchange(monkeypatch):

    def api_request(*args, **kwargs):
        raise HistoryError("This is an error message")

    plugin = HistoryList()

    monkeypatch.setenv("NAAS_COURSE_ID", "my_course_code")

    data = {}
    with patch.object(Exchange, "api_request", side_effect=api_request):
        data = plugin.list_history()

    assert data["success"] is False
    assert data["value"] == "Connection to the exchange failed: This is an error message"


@pytest.mark.gen_test
def test_list_history_api_query_times_out(monkeypatch):

    def api_request(*args, **kwargs):
        raise requests.exceptions.Timeout

    plugin = HistoryList()

    monkeypatch.setenv("NAAS_COURSE_ID", "my_course_code")

    data = {}
    with patch.object(Exchange, "api_request", side_effect=api_request):
        data = plugin.list_history()

    assert data["success"] is False
    assert data["value"] == "Timed out trying to reach the exchange service to list history."


@pytest.mark.gen_test
def test_list_history_query_exchange_throws_exchange_error(monkeypatch):

    def query_exchange(*args, **kwargs):
        raise ExchangeError

    plugin = HistoryList()

    monkeypatch.setenv("NAAS_COURSE_ID", "my_course_code")

    data = {}
    with patch.object(HistoryList, "query_exchange", side_effect=query_exchange):
        data = plugin.list_history()

    assert data["success"] is False
    error_string = data["value"]
    assert "The exchange directory does not exist and could" in error_string


@pytest.mark.gen_test
def test_list_history_query_exchange_throws_base_exception(monkeypatch):

    def query_exchange(*args, **kwargs):
        raise Exception

    plugin = HistoryList()
    monkeypatch.setenv("NAAS_COURSE_ID", "my_course_code")

    data = {}
    with patch.object(HistoryList, "query_exchange", side_effect=query_exchange):
        data = plugin.list_history()

    assert data["success"] is False
    assert "Traceback (most recent call last):" in data["value"]


@pytest.mark.gen_test
def test_list_history_query_exchange_times_out(monkeypatch):

    def query_exchange(*args, **kwargs):
        raise requests.exceptions.Timeout

    plugin = HistoryList()

    monkeypatch.setenv("NAAS_COURSE_ID", "my_course_code")

    data = {}
    with patch.object(HistoryList, "query_exchange", side_effect=query_exchange):
        data = plugin.list_history()

    assert data["success"] is False
    assert "Traceback (most recent call last):" in data["value"]
