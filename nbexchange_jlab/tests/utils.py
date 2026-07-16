import asyncio
import base64
import io
import os
import tarfile
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from functools import partial

import requests

#####
#
# Check in handlers.auth.naas_user_handlers.NaasUserHandler - username.replace("_", "-", 1)
#
user_kiz = {"name": "1-kiz"}
user_bert = {"name": "1-bert"}

user_kiz_instructor = {
    "id": 1,
    "name": "1-kiz",
    "course_id": "course_2",
    "course_role": "Instructor",
    "course_title": "A title",
}

user_kiz_student = {
    "id": 1,
    "name": "1-kiz",
    "course_id": "course_2",
    "course_role": "Student",
    "course_title": "A title",
}

user_zik_student = {
    "id": 2,
    "name": "1-zik",
    "course_id": "course_2",
    "course_role": "Student",
    "course_title": "A title",
    "full_name": "One Zik",
    "email": "zik@example.com",
    "lms_user_id": "zik",
}

user_brobbere_instructor = {
    "id": 3,
    "name": "1-brobbere",
    "course_id": "course_2",
    "course_role": "Instructor",
    "course_title": "A title",
}

user_brobbere_student = {
    "id": 3,
    "name": "1-brobbere",
    "course_id": "course_2",
    "course_role": "Student",
}

user_lkihlman_instructor = {
    "id": 4,
    "name": "1-lkihlman",
    "course_id": "course_1",
    "course_role": "Instructor",
    "course_title": "Another title",
}

user_lkihlman_student = {
    "id": 4,
    "name": "1-lkihlman",
    "course_id": "course_1",
    "course_role": "Student",
}

root_notebook_name = "assignment-0.6"
timestamp = "2020-01-01 00:00:00.000000 +0000"

mock_api_released_assign_a_0_seconds = {
    "assignment_id": "assign_a",
    "student_id": 1,
    "course_id": "no_course",
    "status": "released",
    "path": "released/1/assign_a/foo",
    "notebooks": [
        {
            "notebook_id": root_notebook_name,
            "has_exchange_feedback": False,
            "feedback_updated": False,
            "feedback_timestamp": None,
        }
    ],
    "timestamp": timestamp,
}
mock_api_released_assign_b_0_seconds = {
    "assignment_id": "assign_b",
    "student_id": 1,
    "course_id": "no_course",
    "status": "released",
    "path": "released/1/assign_b/foo",
    "notebooks": [
        {
            "notebook_id": root_notebook_name + "-wrong",
            "has_exchange_feedback": False,
            "feedback_updated": False,
            "feedback_timestamp": None,
        }
    ],
    "timestamp": timestamp,
}

mock_api_fetched_assign_a_0_seconds = {
    "assignment_id": "assign_a",
    "student_id": 1,
    "course_id": "no_course",
    "status": "fetched",
    "path": "released/1/assign_a/foo",
    "notebooks": [
        {
            "notebook_id": root_notebook_name,
            "has_exchange_feedback": False,
            "feedback_updated": False,
            "feedback_timestamp": None,
        }
    ],
    "timestamp": timestamp,
}
mock_api_fetched_assign_b_0_seconds = {
    "assignment_id": "assign_b",
    "student_id": 1,
    "course_id": "no_course",
    "status": "fetched",
    "path": "released/1/assign_b/foo",
    "notebooks": [
        {
            "notebook_id": root_notebook_name,
            "has_exchange_feedback": False,
            "feedback_updated": False,
            "feedback_timestamp": None,
        }
    ],
    "timestamp": timestamp,
}

mock_api_submit_assign_a_0_seconds = {
    "assignment_id": "assign_a",
    "student_id": 1,
    "course_id": "no_course",
    "status": "submitted",
    "path": "submitted/1/assign_a/1/foo",
    "notebooks": [
        {
            "notebook_id": root_notebook_name,
            "has_exchange_feedback": False,
            "feedback_updated": False,
            "feedback_timestamp": None,
        }
    ],
    "timestamp": timestamp,
}

mock_api_release_feedback_assign_a_0_seconds = {
    "assignment_id": "assign_a",
    "course_id": "no_course",
    "notebooks": [
        {
            "feedback_timestamp": None,
            "feedback_updated": False,
            "has_exchange_feedback": False,
            "notebook_id": root_notebook_name,
        },
    ],
    "path": "feedback/1/9cf90d9fcb620713a78b08106f9fcbbc.html",
    "status": "feedback_released",
    "student_id": 1,
    "timestamp": timestamp,
}


def tar_source(filename):
    import tarfile

    tar_file = io.BytesIO()

    with tarfile.open(fileobj=tar_file, mode="w:gz") as tar_handle:
        tar_handle.add(filename, arcname=".")
    tar_file.seek(0)
    return tar_file.read()


def api_request(self, url, method="GET", *args, **kwargs):
    headers = {}

    if method == "GET":
        get_req = partial(requests.get, url, headers=headers)
        return get_req(*args, **kwargs)
    elif method == "POST":
        post_req = partial(requests.post, url, headers=headers)
        return post_req(*args, **kwargs)
    elif method == "DELETE":
        delete_req = partial(requests.delete, url, headers=headers)
        return delete_req(*args, **kwargs)
    else:
        raise NotImplementedError(f"HTTP Method {method} is not implemented")


def get_feedback_dict(filename):
    with open(filename) as feedback_file:
        files = {"feedback": ("feedback.html", feedback_file.read())}
    return files


def get_feedback_file(filename):
    with open(filename, "rb") as feedback_file:
        files = base64.b64encode(feedback_file.read())
    return files


# Another method created by ELM - does this make me a lazy programmer?
def create_any_tarball(target_size_bytes=int(1e9)):  # Default size set to about 1GB
    data = os.urandom(target_size_bytes)
    tar_file = io.BytesIO()

    with tarfile.open(fileobj=tar_file, mode="w:gz") as tar_handle:

        with closing(io.BytesIO(data)) as fobj:
            tarinfo = tarfile.TarInfo("filler.bin")
            tarinfo.size = len(fobj.getvalue())
            tarinfo.mtime = time.time()
            tar_handle.addfile(tarinfo, fileobj=fobj)

    tar_file.seek(0)

    return tar_file.read()


class _AsyncRequests:
    """Wrapper around requests to return a Future from request methods
    A single thread is allocated to avoid blocking the IOLoop thread.
    """

    def __init__(self):
        self.executor = ThreadPoolExecutor(1)
        real_submit = self.executor.submit
        self.executor.submit = lambda *args, **kwargs: asyncio.wrap_future(real_submit(*args, **kwargs))

    def __getattr__(self, name):
        requests_method = getattr(requests, name)
        return lambda *args, **kwargs: self.executor.submit(requests_method, *args, **kwargs)


# async_requests.get = requests.get returning a Future, etc.
async_requests = _AsyncRequests()


class AsyncSession(requests.Session):
    """requests.Session object that runs in the background thread"""

    def request(self, *args, **kwargs):
        return async_requests.executor.submit(super().request, *args, **kwargs)
