import { Widget } from '@lumino/widgets';

import { PageConfig } from '@jupyterlab/coreutils';
// disabled, 'cos I can't test them: import { Notification } from '@jupyterlab/apputils';

import { requestAPI } from '../handler';

interface IActionType {
  id: string;
  display: string;
}

const actionTypes: IActionType[] = [
  { id: 'AssignmentActions.released', display: 'Released' },
  { id: 'AssignmentActions.fetched', display: 'Fetched' },
  { id: 'AssignmentActions.submitted', display: 'Submitted' },
  { id: 'AssignmentActions.collected', display: 'Collected' },
  { id: 'AssignmentActions.feedback_released', display: 'Feedback Released' },
  { id: 'AssignmentActions.feedback_fetched', display: 'Feedback Fetched' }
];

interface IActionData {
  action: string;
  path: string;
  timestamp: string;
  user: string;
}

// `foo?:` indicates a field that may not be present
interface IActionSummaryData {
  released: number;
  fetched?: number;
  submitted?: number;
  collected?: number;
  feedback_released?: number;
  feedback_fetched?: number;
}

interface IAssignmentData {
  assignment_id: number;
  assignment_code: string;
  actions: IActionData[];
  action_summary: IActionSummaryData;
}

interface ICourseData {
  role: { Instructor?: number; Student?: number };
  user_id: any;
  assignments: IAssignmentData[];
  isInstructor: boolean;
  isCurrent: boolean;
  course_id: number;
  course_code: string;
  course_title: string;
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

  private load_list_success(data: ICourseData[]): void {
    if (data === null) {
      this.show_info(
        '<p>There is no history available from the Exchange service</p>'
      );
      return;
    }
    if (typeof data !== 'object') {
      this.show_error(
        '<p>HistoryList.load_list() failed with success not true:</p>\n<pre>' +
          String(data) +
          '</pre>'
      );
      return;
    }
    if (data.length === 0) {
      this.show_info(
        '<p>There is zero history available from the Exchange service'
      );
      return;
    }
    if (data.length === 1) {
      for (const key in data) {
        const this_course = data[key];
        if (!('assignments' in this_course)) {
          this.show_info('<p>There is no history to show you</p>');
          return;
        }
        const assignments: IAssignmentData[] = this_course['assignments'];
        if (assignments.length === 0) {
          this.show_info('<p>There is no history to show you</p>');
          return;
        }
      }
    }
    this.clear_list();

    for (const key in data.reverse()) {
      const this_course = data[key];
      const assignments: IAssignmentData[] = this_course['assignments'];

      if (assignments.length === 0) {
        continue;
      }

      let isCurrent = false;
      if (this_course['isCurrent']) {
        isCurrent = true;
      }
      let first_date: string = this.formatDate(new Date()); // today
      let latest_date: string = this.formatDate(new Date(2000, 1, 1)); // yonks back
      const role = this_course['isInstructor'] ? 'Instructor' : 'Student';
      const detail_group_name = this_course['course_code'];

      const course_panel_elem = document.createElement('details');

      // if this is the current course prepended, else appended
      if (isCurrent) {
        this.panel_group_element.prepend(course_panel_elem);
      } else {
        this.panel_group_element.append(course_panel_elem);
      }

      course_panel_elem.setAttribute('name', 'course_level_group');
      course_panel_elem.classList.add('course_group');
      if (isCurrent) {
        course_panel_elem.classList.add('current_course');
      }
      const top_level_summary_id = 'course_id_' + this_course['course_id'];
      course_panel_elem.setAttribute('aria-labelledby', top_level_summary_id);

      const para_elem = document.createElement('summary');
      para_elem.setAttribute('id', top_level_summary_id);

      course_panel_elem.append(para_elem);

      para_elem.textContent +=
        this_course['course_title'] + ' (' + detail_group_name + ')';

      for (const assignment of assignments) {
        const assignment_code = assignment['assignment_code'];
        const assignment_id = assignment['assignment_id'];

        // Create assignment panel
        const assignment_panel_elem = document.createElement('details');
        assignment_panel_elem.classList.add(
          'panel',
          'panel-default',
          'panel_radiused'
        );
        assignment_panel_elem.setAttribute('name', detail_group_name);
        const panel_body_id = 'assignment-panel-body-' + assignment_id;
        const assignment_level_summary_id =
          'assignment_level_summary_' + assignment_id;

        assignment_panel_elem.innerHTML = [
          '      <summary class="panel-heading" id="' +
            assignment_level_summary_id +
            '">' +
            assignment_code +
            ' &lt;' +
            role +
            '&gt;',
          '      </summary>',
          '      <div class="panel-body" id="' + panel_body_id + '">',
          '      </div>'
        ].join('\n');
        assignment_panel_elem.setAttribute(
          'aria-labelledby',
          assignment_level_summary_id
        );

        course_panel_elem.append(assignment_panel_elem);

        const actions: IActionData[] = assignment['actions'];

        // Try and get 1st & last dates
        for (const action of actions) {
          const this_date = this.formatDate(new Date(action['timestamp']));
          if (this_date < first_date) {
            first_date = this_date;
          }
          if (this_date > latest_date) {
            latest_date = this_date;
          }
        }

        for (let j = 0; j < actionTypes.length; j++) {
          const groupActions: any[] = actions.filter(
            a => a.action === actionTypes[j].id
          );

          // Add group in panel_body_id
          new ActionGroup(
            this.widget,
            assignment_panel_elem,
            panel_body_id,
            this_course['course_code'],
            isCurrent,
            role,
            assignment_code,
            actionTypes[j].display,
            groupActions
          );
        }
      }

      // Update the course name string to includes dates
      para_elem.textContent += ' - ' + first_date + ' -> ' + latest_date;
      if (this_course['isCurrent']) {
        para_elem.textContent += ' (current course)';
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/ban-types
  public async load_list(course?: string) {
    this.clear_list();
    let data: any = null;
    try {
      data = await requestAPI<any>('history?course_id=' + course);
    } catch (reason) {
      console.error('load_list caught error:', reason);
      const msg: string = `Error on GET /history.\n${reason}`;
      this.show_error('<p>' + msg + '</p>');
      return;
    }

    if (data.success) {
      this.load_list_success(<any[]>data.value);
    } else {
      if (typeof data === 'string') {
        this.show_error(
          '<p>HistoryList.load_list() failed with string:</p>\n<pre>' +
            data +
            '</pre>'
        );
        return;
      }
      this.show_error(
        '<p>HistoryList.load_list() failed with success not true:</p>\n<pre>' +
          data.value +
          '</pre>'
      );
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

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const that = this;
    that.load_list();

    this.refresh_element!.onclick = function () {
      that.load_list();
    };

    this.bind_events();
  }

  private bind_events(): void {
    this.refresh_element!.click();
  }

  private async load_list() {
    try {
      this.history.load_list('moot');
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
  constructor(
    widget: Widget,
    panel_elem: HTMLElement,
    parent: string,
    course_code: string,
    isCurrent: boolean,
    role: string,
    assignment_code: string,
    action_type: string,
    actions: IActionData[]
  ) {
    this.widget = widget;
    const element: HTMLDivElement = document.createElement('div');
    element.classList.add('action-group');
    this.make_row(
      element,
      course_code,
      isCurrent,
      role,
      assignment_code,
      action_type,
      actions
    );
    const div_elements = panel_elem.getElementsByTagName('div');
    const parent_elem = <HTMLDivElement>div_elements.namedItem(parent);
    parent_elem.append(element);
  }

  private make_row(
    element: HTMLDivElement,
    course_code: string,
    isCurrent: boolean,
    role: string,
    assignment_code: string,
    action_type: string,
    actions: IActionData[]
  ): void {
    const action_count = String(actions.length);

    const row = document.createElement('details');
    const summary = document.createElement('summary');

    const count_span = document.createElement('span');
    count_span.classList.add('action-badge');
    count_span.innerText = action_count;

    summary.innerText = action_type;
    summary.append(count_span);
    row.append(summary);
    row.setAttribute(
      'aria-label',
      'Course: ' +
        course_code +
        ', Assignment: ' +
        assignment_code +
        ', Action: ' +
        action_type +
        ', Count: ' +
        action_count +
        ' times'
    );
    for (let i = 0; i < actions.length; i++) {
      new Action(
        this.widget,
        row,
        course_code,
        isCurrent,
        assignment_code,
        role,
        action_type,
        i,
        actions[i]
      );
    }

    element.append(row);
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
