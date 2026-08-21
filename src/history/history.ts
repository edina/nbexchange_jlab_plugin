import { Widget } from '@lumino/widgets';

import { PageConfig } from '@jupyterlab/coreutils';
// disabled, 'cos I can't test them: import { Notification } from '@jupyterlab/apputils';

import { requestAPI } from '../handler';

interface IActionType {
  id: string;
  display: string;
}

const actionTypes: IActionType[] = [
  { id: 'released', display: 'Released' },
  { id: 'fetched', display: 'Fetched' },
  { id: 'submitted', display: 'Submitted' },
  { id: 'removed', display: 'Removed' },
  { id: 'collected', display: 'Collected' },
  { id: 'feedback_released', display: 'Feedback Released' },
  { id: 'feedback_fetched', display: 'Feedback Fetched' }
];

interface IActionData {
  action: string;
  path: string;
  timestamp: string;
  user: string;
}

// `foo?:` indicates a field that may not be present
interface IActionSummaryData {
  [action: string]: number;
}

interface IAssignmentData {
  id: number;
  code: string;
  action_summary: IActionSummaryData;
  first_action_at: string | null;
  last_action_at: string | null;
}

interface ICourseData {
  id: number;
  code: string;
  title: string;
  roles: string[];
  is_instructor: boolean;
  is_current: boolean;
  assignment_count: number;
}

interface IListResponse<T> {
  success: boolean;
  items?: T[];
  value?: string;
  roles?: string[];
  is_instructor?: boolean;
}

interface IActionPage extends IListResponse<IActionData> {
  next_cursor: string | null;
  snapshot: string;
}

export class HistoryList {
  widget: Widget;
  panel_group_selector: string;
  panel_group_element: HTMLDivElement;

  constructor(widget: Widget, panel_group_selector: string) {
    this.panel_group_selector = panel_group_selector;
    this.widget = widget;

    const div_elements = widget.node.getElementsByTagName('div');
    this.panel_group_element = <HTMLDivElement>(
      div_elements.namedItem(panel_group_selector)
    );
  }

  public clear_list(): void {
    this.panel_group_element.innerHTML = '';
    let elem = this.widget.node.querySelector('.alert-danger') as HTMLElement;
    if (elem) {
      elem.innerHTML = '';
      elem.style.display = 'None';
    }
    elem = this.widget.node.querySelector('.alert-info') as HTMLElement;
    if (elem) {
      elem.innerHTML = '';
      elem.style.display = 'None';
    }
    // elem = this.widget.node.querySelector(
    //   '#results-panel-group'
    // ) as HTMLElement;
    // if (elem) {
    //   elem.innerHTML = '';
    // }
  }

  // public, so we can test it
  public formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  public async load_list(): Promise<void> {
    this.clear_list();
    this.show_info('<p>Loading courses…</p>');
    try {
      const data =
        await requestAPI<IListResponse<ICourseData>>('history/courses');
      if (!data.success) {
        this.show_error(
          '<p>' + (data.value || 'Unable to load courses') + '</p>'
        );
        return;
      }
      this.clear_list();
      const courses = data.items || [];
      if (courses.length === 0) {
        this.show_info('<p>There is no history to show you</p>');
        return;
      }
      courses
        .slice()
        .sort((a, b) => Number(b.is_current) - Number(a.is_current))
        .forEach(course => this.renderCourse(course));
    } catch (reason) {
      console.error('load_list caught error:', reason);
      const msg: string = `Error on GET /history/courses.\n${reason}`;
      this.show_error('<p>' + msg + '</p>');
    }
  }

  private renderCourse(course: ICourseData): void {
    const panel = document.createElement('details');
    panel.classList.add('course_group');
    if (course.is_current) {
      panel.classList.add('current_course');
    }
    const summary = document.createElement('summary');
    summary.textContent = `${course.title || course.code} (${course.code}) — ${course.assignment_count} assignments`;
    if (course.is_current) {
      summary.textContent += ' (current course)';
    }
    const body = document.createElement('div');
    body.classList.add('history-course-body');
    panel.append(summary, body);
    this.panel_group_element.append(panel);

    panel.addEventListener('toggle', () => {
      if (
        panel.open &&
        panel.dataset.loaded !== 'true' &&
        panel.dataset.loading !== 'true'
      ) {
        panel.dataset.loading = 'true';
        void this.loadAssignments(course, body).then(loaded => {
          panel.dataset.loading = 'false';
          panel.dataset.loaded = String(loaded);
        });
      }
    });
  }

  private async loadAssignments(
    course: ICourseData,
    body: HTMLDivElement
  ): Promise<boolean> {
    body.textContent = 'Loading assignments…';
    try {
      const data = await requestAPI<IListResponse<IAssignmentData>>(
        `history/courses/${course.id}/assignments`
      );
      if (!data.success) {
        body.textContent = data.value || 'Unable to load assignments';
        return false;
      }
      body.innerHTML = '';
      const assignments = data.items || [];
      if (assignments.length === 0) {
        body.textContent = 'There are no active assignments for this course.';
        return true;
      }
      const role = data.is_instructor ? 'Instructor' : 'Student';
      assignments.forEach(assignment => {
        const panel = document.createElement('details');
        panel.classList.add('panel', 'panel-default', 'panel_radiused');
        const summary = document.createElement('summary');
        summary.classList.add('panel-heading');
        summary.textContent = `${assignment.code} <${role}>`;
        const assignmentBody = document.createElement('div');
        assignmentBody.classList.add('panel-body');
        panel.append(summary, assignmentBody);
        body.append(panel);

        actionTypes.forEach(actionType => {
          const count = assignment.action_summary[actionType.id] || 0;
          if (count > 0) {
            new ActionGroup(
              this.widget,
              assignmentBody,
              course,
              assignment,
              role,
              actionType,
              count
            );
          }
        });
      });
      return true;
    } catch (reason) {
      body.textContent = `Unable to load assignments: ${reason}`;
      return false;
    }
  }

  public show_error(message: string): void {
    const element = this.widget.node.getElementsByClassName(
      'alert-danger'
    )[0] as HTMLElement;
    if (element) {
      element.innerHTML = message;
      element.style.display = 'block';
    } else {
      console.error('show_error element not found');
      // disabled, 'cos I can't test them: Notification.emit(message, 'error', { autoClose: false });
    }
    // disabled, 'cos I can't test them: Notification.emit(message, 'error', { autoClose: false });
  }

  public show_info(message: string): void {
    const element = this.widget.node.getElementsByClassName(
      'alert-info'
    )[0] as HTMLElement;
    if (element) {
      element.innerHTML = message;
      element.style.display = 'block';
    } else {
      console.log('show_info element not found');
      // disabled, 'cos I can't test them: Notification.emit(message, 'error', { autoClose: false });
    }
    // Notification.emit(message, 'info', { autoClose: false });
  }
}

export class CourseList {
  refresh_selector: string;
  history: HistoryList;
  current_course: string | null;
  options = new Map();
  base_url: string;
  data: string[];
  refresh_element: HTMLButtonElement | null;

  constructor(
    widget: Widget,
    refresh_selector: string,
    history: HistoryList,
    options: Map<string, string>
  ) {
    this.refresh_selector = refresh_selector;
    const buttons = widget.node.getElementsByTagName('button');
    this.refresh_element = buttons.namedItem(refresh_selector);

    this.history = history;
    this.current_course = 'select a course';

    this.options = options;
    this.base_url = options.get('base_url') || PageConfig.getBaseUrl();

    this.data = [];

    void this.load_list();
    this.refresh_element!.onclick = () => {
      void this.load_list();
    };
  }

  private async load_list() {
    try {
      await this.history.load_list();
    } catch (reason) {
      const msg: string = 'Error on GET /BaAssignment.\n' + reason;
      this.show_error(msg);
    }
  }

  public show_error(error: string): void {
    // disabled, 'cos I can't test them: Notification.emit(error, 'error', { autoClose: false });
  }
}

class ActionGroup {
  widget: Widget;
  private course: ICourseData;
  private assignment: IAssignmentData;
  private role: string;
  private actionType: IActionType;
  private row: HTMLDetailsElement;
  private actionsElement: HTMLDivElement;
  private loadMoreButton: HTMLButtonElement;
  private cursor: string | null = null;
  private snapshot: string | null = null;
  private loaded = false;
  private loading = false;

  constructor(
    widget: Widget,
    parent: HTMLElement,
    course: ICourseData,
    assignment: IAssignmentData,
    role: string,
    actionType: IActionType,
    count: number
  ) {
    this.widget = widget;
    this.course = course;
    this.assignment = assignment;
    this.role = role;
    this.actionType = actionType;
    const element = document.createElement('div');
    element.classList.add('action-group');
    this.row = document.createElement('details');
    const summary = document.createElement('summary');
    const count_span = document.createElement('span');
    count_span.classList.add('action-badge');
    count_span.innerText = String(count);
    summary.innerText = actionType.display;
    summary.append(count_span);
    this.row.append(summary);
    this.row.setAttribute(
      'aria-label',
      `Course: ${course.code}, Assignment: ${assignment.code}, Action: ${actionType.display}, Count: ${count} times`
    );
    this.actionsElement = document.createElement('div');
    this.loadMoreButton = document.createElement('button');
    this.loadMoreButton.classList.add(
      'btn',
      'btn-default',
      'history-load-more'
    );
    this.loadMoreButton.textContent = 'Load more';
    this.loadMoreButton.style.display = 'none';
    this.loadMoreButton.onclick = () => void this.loadPage();
    this.row.append(this.actionsElement, this.loadMoreButton);
    this.row.addEventListener('toggle', () => {
      if (this.row.open && !this.loaded) {
        void this.loadPage().then(loaded => {
          this.loaded = loaded;
        });
      }
    });
    element.append(this.row);
    parent.append(element);
  }

  private async loadPage(): Promise<boolean> {
    if (this.loading) {
      return false;
    }
    this.loading = true;
    this.loadMoreButton.disabled = true;
    const params = new URLSearchParams({
      action: this.actionType.id,
      limit: '100'
    });
    if (this.cursor) {
      params.set('cursor', this.cursor);
    }
    if (this.snapshot) {
      params.set('snapshot', this.snapshot);
    }
    try {
      const data = await requestAPI<IActionPage>(
        `history/assignments/${this.assignment.id}/actions?${params.toString()}`
      );
      if (!data.success) {
        throw new Error(data.value || 'Unable to load actions');
      }
      const actions = data.items || [];
      actions.forEach((action, index) => {
        new Action(
          this.widget,
          this.actionsElement,
          this.course.code,
          this.course.is_current,
          this.assignment.code,
          this.role,
          this.actionType.display,
          index,
          action
        );
      });
      this.cursor = data.next_cursor;
      this.snapshot = data.snapshot;
      this.loadMoreButton.style.display = this.cursor ? 'inline-block' : 'none';
      return true;
    } catch (reason) {
      const error = document.createElement('p');
      error.classList.add('history-load-error');
      error.textContent = `Unable to load actions: ${reason}`;
      this.actionsElement.append(error);
      return false;
    } finally {
      this.loading = false;
      this.loadMoreButton.disabled = false;
    }
  }
}

class Action {
  widget: Widget;

  constructor(
    widget: Widget,
    parent_elem: HTMLElement,
    course_code: string,
    isCurrent: boolean,
    assignment_code: string,
    role: string,
    action_type: string,
    row_index: number,
    data: IActionData
  ) {
    this.widget = widget;
    const element: HTMLDivElement = document.createElement('div');
    element.classList.add('action-row');
    this.make_row(
      element,
      course_code,
      isCurrent,
      assignment_code,
      role,
      action_type,
      row_index,
      data
    );
    parent_elem.append(element);
  }

  // `Download` pulls the tarball down and saves _as the tarball_ in the home directory
  // `collect` actually triggers an nbgrader collect on the server side, replacing any existing files
  private async do_download(
    course_code: string,
    assignent_code: string,
    student: string,
    path: string
  ) {
    const alert_area = document.querySelector('.alert-info') as HTMLElement;
    if (alert_area) {
      let data: any = null;
      try {
        const url =
          'hisDownload?course_code=' +
          encodeURIComponent(course_code) +
          '&assignment_code=' +
          encodeURIComponent(assignent_code) +
          '&student=' +
          encodeURIComponent(student) +
          '&path=' +
          encodeURIComponent(path);

        data = await requestAPI<any>(url);
      } catch (reason) {
        console.error('Action do_download caught error:', reason);
        const msg: string = 'Error on GET hisDownload.\n' + reason;
        this.show_error('<p>' + msg + '</p>');
      }
      if (data) {
        alert_area.innerHTML = data.value;
        alert_area.style.display = 'block';
      }
    } else {
      console.log('alert box not found');
    }
  }

  private async do_collect(
    course_code: string,
    assignent_code: string,
    student: string,
    path: string
  ) {
    const alert_area = document.querySelector('.alert-info') as HTMLElement;
    if (alert_area) {
      let data: any = null;
      try {
        const url =
          'hisCollect?course_code=' +
          encodeURIComponent(course_code) +
          '&assignment_code=' +
          encodeURIComponent(assignent_code) +
          '&student=' +
          encodeURIComponent(student) +
          '&path=' +
          encodeURIComponent(path);

        data = await requestAPI<any>(url);
      } catch (reason) {
        console.error('Action do_collect caught error:', reason);
        const msg: string = 'Error on GET hisCollect.\n' + reason;
        this.show_error('<p>' + msg + '</p>');
      }

      if (data) {
        alert_area.innerHTML = data.value;
        alert_area.style.display = 'block';
      }
    } else {
      console.log('alert box not found');
    }
  }

  private make_button(
    row_index: number,
    text: string,
    disabled: boolean,
    do_Action: (params: any) => void,
    actionParams: any
  ): HTMLButtonElement {
    const button: HTMLButtonElement = document.createElement('button');
    button.classList.add('btn');
    button.setAttribute(
      'aria-label',
      text +
        ' for Course: ' +
        actionParams['course_code'] +
        ', Assignment: ' +
        actionParams['assignment_code'] +
        ', Student: ' +
        actionParams['student'] +
        ' (' +
        (row_index + 1) +
        ')'
    );
    button.style.margin = '0 1em';
    if (disabled) {
      button.disabled = true;
    } else {
      button.classList.add('btn-primary');
    }
    button.onclick = async () => {
      await do_Action(actionParams);
    };
    button.innerText = text;
    return button;
  }

  private make_row(
    element: HTMLDivElement,
    course_code: string,
    isCurrent: boolean,
    assignment_code: string,
    role: string,
    action_type: string,
    row_index: number,
    data: IActionData
  ): void {
    const row = document.createElement('div');
    row.classList.add('col-md-12');

    const timestamp_span = document.createElement('span');
    timestamp_span.classList.add('col-sm-4');
    const user_span = document.createElement('span');
    user_span.classList.add('col-sm-4');
    const buttons_span = document.createElement('span');
    buttons_span.classList.add('col-sm-4');
    buttons_span.classList.add('action_buttons');

    const date = new Date(data['timestamp']);
    timestamp_span.innerText =
      date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    user_span.innerText = data['user'];

    if (action_type === 'Submitted') {
      // client-side code needs course_code, assignment_id, student, path
      const fetch_params = {
        course_code: course_code,
        assignment_code: assignment_code,
        student: data['user'],
        path: data['path']
      };

      if (role === 'Instructor') {
        if (isCurrent) {
          const collectButton: HTMLButtonElement = this.make_button(
            row_index,
            'collect',
            false,
            this.do_collect.bind(
              this,
              course_code,
              assignment_code,
              data['user'],
              data['path']
            ),
            fetch_params
          );
          buttons_span.append(collectButton);
        }

        const downloadButton: HTMLButtonElement = this.make_button(
          row_index,
          'download',
          false,
          this.do_download.bind(
            this,
            course_code,
            assignment_code,
            data['user'],
            data['path']
          ),
          fetch_params
        );
        buttons_span.append(downloadButton);
      }
    }
    row.append(timestamp_span);
    row.append(user_span);
    row.append(buttons_span);

    element.append(row);
  }

  private show_error(message: string): void {
    const element = this.widget.node.getElementsByClassName(
      'alert-danger'
    )[0] as HTMLElement;
    if (element) {
      element.innerHTML = message;
      element.style.display = 'block';
    } else {
      console.error('show_error element not found');
      // disabled, 'cos I can't test them: Notification.emit(message, 'error', { autoClose: false });
    }
    // disabled, 'cos I can't test them: Notification.emit(message, 'error', { autoClose: false });
  }
}
