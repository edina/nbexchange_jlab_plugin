import json
import os
import shutil
from urllib.parse import quote_plus

import requests
from nbgrader.api import Gradebook, MissingEntry
from nbgrader.exchange import ExchangeCollect as ABCExchangeCollect

from .exchange import Exchange as NBExchange


class ExchangeCollect(ABCExchangeCollect, NBExchange):
    def do_copy(self, src, dest):
        pass

    # A check that we actually have a course_id!
    # This should be set
    def init_src(self):
        if self.coursedir.course_id == "":
            self.fail("No course id specified. Re-run with --course flag.")

    def init_dest(self):
        pass

    def download(self, submission, dest_path):
        self.log.debug(f"ExchangeCollect.download - record {submission} to {dest_path}")
        query = f"collection?course_id={quote_plus(self.coursedir.course_id)}&assignment_id={quote_plus(self.coursedir.assignment_id)}&path={quote_plus(submission['path'])}"  # noqa: E501
        response = self.common_download(query_url=query, detination_path=dest_path)
        if not response["success"]:
            self.log.error(f"Collect download failed: {response['value']}")
            self.fail(f"Collect download failed: {response['value']}")

    # Note: this function needs to convert a datetime to a string in the same format as the timestamp_format, so
    # that it can be compared with the submission timestamp from the exchange server.
    # The submission timestamp is a string in the same format as timestamp_format.
    def _get_duedate(self):
        with Gradebook(self.coursedir.db_url, self.coursedir.course_id) as gb:
            try:
                assignment = gb.find_assignment(self.coursedir.assignment_id)
                if assignment.duedate is None:
                    return None
                if type(assignment.duedate) is str:
                    return assignment.duedate
                else:
                    return self.check_timezone(assignment.duedate).strftime(self.timestamp_format)
            except MissingEntry as e:
                self.log.info(f"Error occurred while trying to convert DueDate: {e}")
                return None

    def do_collect(self):
        """
        Downloads submitted files

        If coursedir.student_id, then we're only looking for that user"""

        # Get a list of submissions
        url = f"collections?course_id={quote_plus(self.coursedir.course_id)}&assignment_id={quote_plus(self.coursedir.assignment_id)}"  # noqa: E501
        if self.coursedir.student_id != "*":
            url = url + f"&user_id={quote_plus(self.coursedir.student_id)}"
        try:
            r = self.api_request(url)
        except requests.exceptions.Timeout:
            self.fail("Timed out trying to reach the exchange service to get a list of submissions.")

        self.log.debug(f"Got back {r} when listing collectable assignments")

        try:
            data = r.json()
        except json.decoder.JSONDecodeError as err:
            self.log.error(f"Got back an invalid response when listing assignments: {err}")
            return []

        if not data["success"]:
            self.fail("Error looking for assignments to collect")

        submissions = data["value"]

        self.log.debug(f"ExchangeCollect.do_collection found the following items: {submissions}")

        if len(submissions) == 0:
            self.log.warning(
                f"No submissions of '{self.coursedir.assignment_id}' for course '{self.coursedir.course_id}' to collect"
            )
        else:
            self.log.info(
                f"Processing {len(submissions)} submissions of '{self.coursedir.assignment_id}' for course '{self.coursedir.course_id}'"  # noqa: E501
            )

        self.duedate = self._get_duedate()
        for submission in submissions:
            # Skip any submissions after the due date
            if self.duedate and submission["timestamp"] > self.duedate:
                continue

            student_id = submission["student_id"]
            full_name = submission.get("full_name") or ""
            if " " in full_name:
                first_name, last_name = full_name.rsplit(" ", 1)
            else:
                first_name, last_name = (
                    full_name,
                    "",
                )  # TODO: should we prefer first or last name here?
            email = submission.get("email") or ""
            lms_user_id = submission.get("lms_user_id") or ""

            # self.coursedir.submitted_directory gets defined in `list.py`
            #   otherwise this is consistent with the upstream code
            if student_id:
                local_dest_path = self.coursedir.format_path(
                    self.coursedir.submitted_directory,
                    student_id,
                    self.coursedir.assignment_id,
                )
                if not os.path.exists(os.path.dirname(local_dest_path)):
                    os.makedirs(os.path.dirname(local_dest_path))

                self.log.debug(f"ExchangeCollect.do_collection - collection dest : {local_dest_path}")

                take_a_copy = False
                updated_version = False
                if os.path.isdir(local_dest_path):
                    existing_timestamp = self.coursedir.get_existing_timestamp(local_dest_path)
                    existing_timestamp = (
                        existing_timestamp.strftime(self.timestamp_format) if existing_timestamp else None
                    )
                    new_timestamp = submission["timestamp"]
                    if self.update and (existing_timestamp is None or new_timestamp > existing_timestamp):
                        take_a_copy = True
                        updated_version = True
                else:
                    take_a_copy = True

                if take_a_copy:
                    if updated_version:
                        self.log.info(f"Updating submission: {student_id} {self.coursedir.assignment_id}")
                        # clear existing
                        shutil.rmtree(local_dest_path)
                    else:
                        self.log.info(f"Collecting submission: {student_id} {self.coursedir.assignment_id}")

                    with Gradebook(self.coursedir.db_url, self.coursedir.course_id) as gb:
                        try:
                            gb.update_or_create_student(
                                student_id,
                                first_name=first_name,
                                last_name=last_name,
                                email=email,
                                lms_user_id=lms_user_id,
                            )
                        except MissingEntry:
                            self.log.info(
                                f"Unable to update: {student_id} with first_name={first_name}, last_name={last_name}"
                            )
                    self.download(submission, local_dest_path)
                else:
                    if self.update:
                        self.log.info(f"No newer submission to collect: {student_id} {self.coursedir.assignment_id}")
                    else:
                        self.log.info(
                            f"Submission already exists, use --update to update: {student_id} {self.coursedir.assignment_id}"  # noqa: E501
                        )

    def copy_files(self):
        self.do_collect()
