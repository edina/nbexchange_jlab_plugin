"""Tornado handlers for nbgrader course list web service."""

import contextlib
import json
import os
import shutil
import traceback
from typing import Dict, List
from urllib.parse import quote_plus

import requests
from jupyter_server.base.handlers import JupyterHandler
from jupyter_server.utils import url_path_join
from nbgrader.auth import Authenticator
from nbgrader.coursedir import CourseDirectory
from tornado import web

from nbexchange_jlab.plugins import Exchange, ExchangeCollect, ExchangeError
from nbexchange_jlab.utils import BaseListerClass, get_current_course


@contextlib.contextmanager
def chdir(dirname):
    currdir = os.getcwd()
    os.chdir(dirname)
    yield
    os.chdir(currdir)


class HistoryError(Exception):
    pass


class HistoryList(BaseListerClass):
    SUPPORTED_METHODS = ("GET", "HEAD")

    # This gives us all the exchange config details & functions
    exchange: Exchange = None

    @property
    def root_dir(self) -> str:
        return self._root_dir

    @root_dir.setter
    def root_dir(self, directory) -> None:
        self._root_dir = directory

    def query_exchange(self) -> Dict | List | str | Exception:
        """
        This queries the database for all the actions for a course

        Note that the exchange itself filters the return, based on the identity
        of the person making the call: students only see released actions and their
        own actions; instructors see all actions
        """

        try:
            if self.exchange.coursedir.course_id:
                """List history for specific course"""
                self.log.info(f"calling exchange.api_request with course_code {self.exchange.coursedir.course_id}")
                r = self.exchange.api_request(f"history?course_id={quote_plus(self.exchange.coursedir.course_id)}")
            else:
                """List history for all courses"""
                self.log.info("calling exchange.api_request withOUT course_code")
                r = self.exchange.api_request("history")
        except requests.exceptions.Timeout:
            raise HistoryError("Timed out trying to reach the exchange service to list history.")
        except Exception as e:
            raise HistoryError(f"Connection to the exchange failed: {e}")
        if r.status_code >= 400:
            raise HistoryError(r.reason)
        self.log.debug(f"Got back {r} when listing history")

        try:
            history = r.json()
        except AttributeError:
            msg = f"Got back an invalid response when history: response text: '{r.text}'"
            self.log.error(msg)
            raise HistoryError(msg)
        if not isinstance(history, dict):
            raise HistoryError(f"Invalid response from the exchange: {history}")
        response_keys = list(history.keys())
        if set(response_keys) != set(["success", "value"]):
            raise HistoryError(f"Invalid response from the exchange: {history}")

        if not history["success"]:
            raise HistoryError(f"Error message from exchange: '{history['value']}'")

        current_course_code = get_current_course()

        for item in history["value"]:
            if item["course_code"] == current_course_code:
                item["isCurrent"] = True
            else:
                item["isCurrent"] = False

        return history["value"]

    def list_history(self, course_id: str = None) -> Dict | str | Exception:
        if not get_current_course():
            return {"success": False, "value": "You need to have a current course code."}
        self.log.info(f"Listing history for course_id {course_id} (current course is {get_current_course()})")
        with self.yield_config() as config:

            try:
                # if course_id:
                #     config.CourseDirectory.course_id = course_id
                # else:
                config.CourseDirectory.course_id = get_current_course()

                coursedir = CourseDirectory(config=config)
                authenticator = Authenticator(config=config)
                self.exchange = Exchange(coursedir=coursedir, authenticator=authenticator, config=config)

                history = self.query_exchange()
            except HistoryError as e:
                retvalue = {"success": False, "value": str(e)}
            except Exception as e:
                self.log.error(traceback.format_exc())
                if isinstance(e, ExchangeError):
                    retvalue = {
                        "success": False,
                        "value": (
                            "The exchange directory does not exist and could",
                            "not be created. The 'release' and 'collect' functionality will not be available.",
                            "Please see the documentation on",
                            "http://nbgrader.readthedocs.io/en/stable/user_guide/managing_assignment_files.html#setting-up-the-exchange",  # noqa E501
                            "for instructions.",
                        ),
                    }
                else:
                    retvalue = {"success": False, "value": traceback.format_exc()}
            else:
                retvalue = {"success": True, "value": history}

        return retvalue

    def _setup_download(
        self, config: dict, course_code: str = None, assignment_code: str = None, student: str = None
    ) -> ExchangeCollect:

        if not (config and course_code and assignment_code and student):
            raise ValueError(
                f"Failed to define one of config [{config}], [course_code {course_code}]",
                f"assignment_code [{assignment_code}], or student [{student}]",
            )

        if course_code:
            config.CourseDirectory.course_id = course_code

        coursedir = CourseDirectory(config=config)
        authenticator = Authenticator(config=config)
        nbc = ExchangeCollect(coursedir=coursedir, authenticator=authenticator, config=config)

        # These need set up for collect.download
        nbc.coursedir.assignment_id = assignment_code
        nbc.coursedir.student_id = student

        return nbc

    def _do_download(self, nbc: ExchangeCollect = None, local_dest_path: str = None, exchange_path: str = None):

        if not os.path.exists(os.path.dirname(local_dest_path)):
            os.makedirs(os.path.dirname(local_dest_path))
        if os.path.isdir(local_dest_path):
            shutil.rmtree(local_dest_path)

        # Fake up a submission dict for download
        submission = {"path": exchange_path}
        nbc.download(submission, local_dest_path)

    def do_download(
        self, course_code: str = None, assignment_code: str = None, student: str = None, path: str = None
    ) -> Dict:

        if not get_current_course():
            return {"success": False, "value": "You need to have a current course code."}

        retvalue = {"success": False, "value": "No reason given"}

        with self.yield_config() as config:
            local_dest_path = "home"

            try:
                nbc = self._setup_download(
                    config=config, course_code=course_code, assignment_code=assignment_code, student=student
                )

                local_dest_path = os.path.join(
                    os.environ.get("HOME", "."),
                    "Downloads",
                    nbc.coursedir.course_id,
                    student,
                    nbc.coursedir.assignment_id,
                )
                self._do_download(nbc, local_dest_path, path)

            except HistoryError as e:
                retvalue = {"success": False, "value": str(e)}
            except Exception as e:
                self.log.error(traceback.format_exc())
                if isinstance(e, ExchangeError):
                    retvalue = {
                        "success": False,
                        "value": (f"History download had an ExchangeError: {str(e)}"),
                    }
                else:
                    retvalue = {"success": False, "value": traceback.format_exc()}
            else:
                retvalue = {"success": True, "value": f"Downloaded into {local_dest_path}"}

        return retvalue

    def do_collect(
        self, course_code: str = None, assignment_code: str = None, student: str = None, path: str = None
    ) -> Dict:

        if not get_current_course():
            return {"success": False, "value": "You need to have a current course code."}

        retvalue = {"success": False, "value": "No reason given"}

        with self.yield_config() as config:
            local_dest_path = "home"

            try:
                nbc = self._setup_download(
                    config=config, course_code=course_code, assignment_code=assignment_code, student=student
                )
                local_dest_path = os.path.join(
                    os.environ.get("HOME", "."),
                    nbc.coursedir.format_path(
                        nbc.coursedir.submitted_directory,
                        student,
                        nbc.coursedir.assignment_id,
                    ),
                )
                self._do_download(nbc, local_dest_path, path)

            except HistoryError as e:
                retvalue = {"success": False, "value": str(e)}
            except Exception as e:
                self.log.error(f"do_collect has an exception: {traceback.format_exc()}")
                if isinstance(e, ExchangeError):
                    retvalue = {
                        "success": False,
                        "value": (f"History collect had an ExchangeError: {str(e)}"),
                    }
                else:
                    retvalue = {"success": False, "value": traceback.format_exc()}
            else:
                retvalue = {"success": True, "value": f"Downloaded into {local_dest_path}"}

        return retvalue

    def get(self):
        self.log.info(f"Called get on {self.__class__.__name__}")

    def head(self):
        self.log.info(f"Called head on {self.__class__.__name__}")


class BaseHistoryHandler(JupyterHandler):
    api_timeout = 10

    base_service_url = os.environ.get("NAAS_BASE_URL", "https://noteable.edina.ac.uk/exchange")

    @property
    def manager(self):
        return self.settings["history_list_manager"]


class HistoryListHandler(BaseHistoryHandler):

    @web.authenticated
    def get(self):
        course_id = self.get_argument("course_id")
        self.finish(json.dumps(self.manager.list_history(course_id=course_id)))


class HiCollectAssignmentHandler(BaseHistoryHandler):

    @web.authenticated
    def get(self):
        course_code = self.get_argument("course_code")
        assignment_code = self.get_argument("assignment_code")
        student = self.get_argument("student")
        path = self.get_argument("path")

        self.finish(
            json.dumps(
                self.manager.do_collect(
                    course_code=course_code, assignment_code=assignment_code, student=student, path=path
                )
            )
        )


class HiDownloadHandler(BaseHistoryHandler):

    @web.authenticated
    def get(self):
        course_code = self.get_argument("course_code")
        assignment_code = self.get_argument("assignment_code")
        student = self.get_argument("student")
        path = self.get_argument("path")

        self.finish(
            json.dumps(
                self.manager.do_download(
                    course_code=course_code, assignment_code=assignment_code, student=student, path=path
                )
            )
        )


def setup_handlers(web_app):
    host_pattern = ".*$"

    base_url = web_app.settings["base_url"]
    default_handlers = [
        (r"history", HistoryListHandler),
        (r"hisCollect", HiCollectAssignmentHandler),
        (r"hisDownload", HiDownloadHandler),
    ]

    # Our hander urls are made up of <base_url>, <namespace>, <endpoint>
    # (this is done to keep things out of the nbgrader & jupyterlab handler paths)
    web_app.add_handlers(
        host_pattern,
        [(url_path_join(base_url, "nbexchange-jlab", hook), handler) for hook, handler in default_handlers],
    )


def load_jupyter_server_extension(nbapp):

    web_app = nbapp.web_app
    web_app.settings["history_list_manager"] = HistoryList(parent=nbapp)
    web_app.settings["history_list_manager"].root_dir = nbapp.root_dir

    setup_handlers(web_app)
    name = "nbexchange_jlab"
    nbapp.log.info(f"Registered {name} server extension")
