import fnmatch
import glob
import io
import json
import os
import tarfile
from abc import ABC, abstractmethod
from datetime import datetime
from functools import partial
from textwrap import dedent
from urllib.parse import urljoin
from zoneinfo import ZoneInfo

import requests
from nbgrader.exchange import Exchange as ABCExchange
from nbgrader.exchange import ExchangeError
from traitlets import Bool, Integer, Type, Unicode


class BaseApiPlugin(ABC):
    @abstractmethod
    def prep_api_call(self, path: str) -> list:
        """
        Sets up the url, any cookies, and any headers needed by the jupyterlab plugins
        to call the NBExchange service.

        This allows implimentors to create their own methods for creating authenticated
        connections between the notebook plugins and the NBExchange service

        :param path: The path for the request being made: path-part + parameters
        :return: the url, cookies, and headers to use in the api_request call
        """
        pass


class DefaultApiPlugin(BaseApiPlugin):

    def prep_api_call(self, path: str) -> list:
        self.log.warning("The plugins are using the default prep_api_call. This is probably wrong.")

        url = self.service_url() + path
        cookies = dict()
        headers = dict()

        return url, cookies, headers


class Exchange(ABCExchange):

    path_includes_course = Bool(
        False,
        help=dedent("""
            Whether the path for fetching/submitting  assignments should be
            prefixed with the course name. If this is `False`, then the path
            will be something like `./ps1`. If this is `True`, then the path
            will be something like `./course123/ps1`.
            """),
    ).tag(config=True)

    action_dir = Unicode(
        ".",
        help=dedent("""
            Local path for storing student assignments.  Defaults to '.'
            which is normally Jupyter's notebook_dir.
            """),
    ).tag(config=True)

    base_service_url = Unicode(os.environ.get("NAAS_BASE_URL", "https://noteable.edina.ac.uk")).tag(config=True)

    base_path = Unicode(
        "/services/nbexchange/",
        help=dedent("""
            Base path for api queries into the exchange - should match 'base_url' in the NbExchange App configuration.
            Defaults to '/services/nbexchange/'
            """),
        config=True,
    )

    def service_url(self):
        this_url = urljoin(self.base_service_url, self.base_path)
        self.log.debug(f"service_url: {this_url}")
        return this_url

    max_buffer_size = Integer(5253530000, help="The maximum size, in bytes, of an upload (defaults to 5GB)").tag(
        config=True
    )

    api_timeout = Integer(
        10,
        help="Timeout for plugin enquiries to the Exchange in seconds. Defaults to 10 seconds",
        config=True,
    )

    api_plugin_class = Type(
        DefaultApiPlugin,
        klass=BaseApiPlugin,
        config=True,
        help="The class to use for prepping connections to the exchange",
    )

    def check_timezone(self, value: datetime) -> datetime:
        if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
            value = value.replace(tzinfo=ZoneInfo(self.timezone))
        return value

    def fail(self, msg):
        self.log.fatal(msg)
        raise ExchangeError(msg)

    def prep_api_call(self, path):
        return self.api_plugin_class.prep_api_call(self, path)

    def api_request(self, path, method="GET", *args, **kwargs):

        url, cookies, headers = self.prep_api_call(path)

        self.log.debug(f"Exchange.api_request calling exchange with url {url}")

        if method == "GET":
            self.log.info(f"Exchange.api_request GET has a timeout of {self.api_timeout} seconds")
            get_req = partial(
                requests.get,
                url,
                headers=headers,
                cookies=cookies,
                timeout=self.api_timeout,
            )
            return get_req(*args, **kwargs)
        elif method == "POST":
            post_req = partial(
                requests.post,
                url,
                headers=headers,
                cookies=cookies,
                timeout=self.api_timeout,
            )
            return post_req(*args, **kwargs)
        elif method == "DELETE":
            delete_req = partial(
                requests.delete,
                url,
                headers=headers,
                cookies=cookies,
                timeout=self.api_timeout,
            )
            return delete_req(*args, **kwargs)
        else:
            raise NotImplementedError(f"HTTP Method {method} is not implemented")

    def common_download(self, query_url, detination_path):
        self.log.info("common_download starts")
        try:
            r = self.api_request(query_url)
        except requests.exceptions.Timeout:
            self.log.info("timeout failure")
            return {"success": False, "value": "Timed out trying to reach the exchange service."}

        self.log.debug(f"Common_download got back {r.status_code}  {r.headers['content-type']} after file download")

        if r.status_code > 399:
            self.log.info("status_code > 399")
            return {"success": False, "value": f"status code {r.status_code}: error {r.content}"}  # noqa E501

        if r.headers["content-type"] == "application/gzip":
            tgz = r.content
            if not tgz:
                self.log.info("not tgz")

                return {"success": False, "value": "zero data returned"}  # noqa E501

            try:
                tar_file = io.BytesIO(tgz)
                with tarfile.open(fileobj=tar_file) as handle:
                    handle.extractall(path=detination_path)
                    self.log.info("success")
                    return {
                        "success": True,
                        "value": f"Extracted to {detination_path}",
                    }
            except Exception as e:  # TODO: exception handling
                self.log.info("tarball failure")
                if hasattr(e, "message"):
                    return {
                        "success": False,
                        "value": f"Error unpacking download for {self.coursedir.assignment_id} on course {self.coursedir.course_id}: {e.message}",  # noqa: E501
                    }
                else:
                    return {
                        "success": False,
                        "value": f"Error unpacking download for {self.coursedir.assignment_id} on course {self.coursedir.course_id}: {e}",  # noqa: E501
                    }
        else:
            # Fails, even if the json response is a success (for now)
            try:
                data = r.json()
            except json.decoder.JSONDecodeError as err:
                self.log.error("Failed to download:\n" f"response text: {r.text}\n" f"JSONDecodeError: {err}")
            if "success" not in data:
                return {
                    "success": False,
                    "value": f"Error failing to download for assignment {self.coursedir.assignment_id} on course {self.coursedir.course_id}",  # noqa: E501
                }
            else:
                return {
                    "success": False,
                    "value": f"Error failing to download for assignment {self.coursedir.assignment_id} on course {self.coursedir.course_id}: {data['note']}",  # noqa: E501
                }

    # Function from ELM
    def add_to_tar(self, tar_file, dir_path, exclude_patterns=[]):
        """
        Adds files to the tar file recursively from the directory path while excluding
        certain patterns.

        :param tar_file: TarFile object to add files to.
        :param dir_path: The directory path to start recursive addition.
        :param exclude_patterns: List of patterns to exclude.
        """
        for root, dirs, files in os.walk(dir_path):

            # skip any directories listed in exclude_patterns
            dirs[:] = [item for item in dirs if item not in exclude_patterns]

            for file in files:
                file_path = os.path.join(root, file)

                # Check if the file matches any of the exclude patterns
                if any(fnmatch.fnmatch(file, pattern) for pattern in exclude_patterns):
                    continue  # Skip this file if it matches a pattern

                # Calculate the arcname manually to preserve desired directory structure
                file_path = os.path.join(root, file)
                arcname = os.path.relpath(file_path, start=dir_path)
                tar_file.add(file_path, arcname=arcname)

    def init_src(self):
        """Compute and check the source paths for the transfer."""
        raise NotImplementedError

    def init_dest(self):
        """Compute and check the destination paths for the transfer."""
        raise NotImplementedError

    def copy_files(self):
        """Actually do the file transfer."""
        raise NotImplementedError

    def do_copy(self, src, dest):
        """Copy the src dir to the dest dir omitting the self.coursedir.ignore globs."""
        raise NotImplementedError

    def start(self):
        self.log.debug(f"Called start on {self.__class__.__name__}")
        self.set_timestamp()  # a datetime object

        self.init_src()
        self.init_dest()
        self.copy_files()

    def _assignment_not_found(self, src_path, other_path):
        msg = f"Assignment not found at: {src_path}"
        self.log.fatal(msg)
        found = glob.glob(other_path)
        if found:
            # Normally it is a bad idea to put imports in the middle of
            # a function, but we do this here because otherwise fuzzywuzzy
            # prints an annoying message about python-Levenshtein every
            # time nbgrader is run.
            from fuzzywuzzy import fuzz

            scores = sorted([(fuzz.ratio(self.src_path, x), x) for x in found])
            self.log.error("Did you mean: %s", scores[-1][1])

        raise ExchangeError(msg)
