import { Widget } from '@lumino/widgets';
import { PageConfig } from '@jupyterlab/coreutils';
// import { Notification } from '@jupyterlab/apputils';

import { requestAPI } from '../handler';

interface IAssignmentDetail {
  exchange: number;
  locally: number;
}

interface IAssignmentRecord {
  [key: string]: IAssignmentDetail;
}

interface IBaAssignmentResponse {
  success: string;
  value: string | IAssignmentRecord;
}

export class BaAssignmentsList {
  panel_group_selector: string;
  panel_group_element: HTMLDivElement;
  widget: Widget;

  // eslint-disable-next-line @typescript-eslint/ban-types
  callback: Function | null = null;

  constructor(widget: Widget, panel_group_selector: string) {
    this.panel_group_selector = panel_group_selector;
    this.callback = null;
    this.widget = widget;

    const div_elements = widget.node.getElementsByTagName('div');
    this.panel_group_element = <HTMLDivElement>(
      div_elements.namedItem(panel_group_selector)
    );
  }
}

// This is the list of assignments known for this course
export class AssignmentsList {
  widget: Widget;
  assignment_list_selector: string;
  default_assignment_selector: string;
  refresh_selector: string;
  assignment_list: BaAssignmentsList;
  options = new Map();
  base_url: string;
  assignmentResponseData: IBaAssignmentResponse | null;
  assignment_table_element: HTMLTableElement | null;
  default_assignment_element: HTMLElement | null;
  refresh_element: HTMLButtonElement | null;

  // eslint-disable-next-line @typescript-eslint/ban-types
  callback: Function | null = null;

  constructor(
    widget: Widget,
    assignment_list_selector: string, // where checkboxes go
    default_assignment_selector: string, // the "loading...." message
    refresh_selector: string, // refresh the page
    assignment_list: BaAssignmentsList, // big list of assignments
    options: Map<string, string> // a map
  ) {
    this.assignment_list_selector = assignment_list_selector;
    this.default_assignment_selector = default_assignment_selector;
    this.refresh_selector = refresh_selector;
    this.assignment_table_element = widget.node
      .getElementsByTagName('table')
      .namedItem(assignment_list_selector);
    const buttons = widget.node.getElementsByTagName('button');
    this.widget = widget;

    this.default_assignment_element = document.getElementById(
      default_assignment_selector
    );
    this.refresh_element = buttons.namedItem(refresh_selector);

    this.assignment_list = assignment_list;

    this.options = options;
    this.base_url = options.get('base_url') || PageConfig.getBaseUrl();

    this.assignmentResponseData = null;

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const that = this;

    this.refresh_element!.onclick = function () {
      that.load_list();
    };

    this.bind_events();
  }

  public clear_list(): void {
    this.assignment_table_element!.innerHTML = '';
  }

  private bind_events(): void {
    this.refresh_element!.click();
  }

  // eslint-disable-next-line @typescript-eslint/ban-types
  private async load_list(course?: string) {
    this.clear_list();
    let data: IBaAssignmentResponse = { success: '', value: '' };

    try {
      data = await requestAPI<any>('getAssignment');
    } catch (reason: Error | any) {
      console.error('load_list caught error:', reason);
      const msg: string = 'Error on GET /BaAssignment.\n' + reason;
      this.show_error('<p>' + msg + '</p>');
      return;
    }

    if (data.success) {
      this.handle_load_list(data);
    } else {
      this.show_error(
        '<p>AssignmentsList.load_list() failed:</p>\n<pre>' +
          data.value +
          '</pre>'
      );
    }
  }

  private handle_load_list(data: IBaAssignmentResponse): void {
    if (typeof data.value === 'string') {
      this.show_error(
        '<p>Error fetching gradable assignments:</p>\n<pre>' +
          data.value +
          '</pre>'
      );
    } else {
      this.load_list_success(data.value);
    }
  }

  private async do_collect(assignent_code: string) {
    const results_area = this.widget.node.querySelector(
      '#results-panel-group'
    ) as HTMLElement;
    if (results_area) {
      this.clear_area(results_area);
      let data: any = null;
      try {
        data = await requestAPI<any>(
          'baCollect?assignment_code=' + assignent_code
        );
      } catch (reason) {
        console.error('do_collect caught error:', reason);
        const msg: string = 'Error on GET baCollect.\n' + reason;
        this.show_error('<p>' + msg + '</p>');
      }

      if (data) {
        this.handle_response_data(results_area, data);
      }
    }
  }

  private async do_autograde(assignent_code: string) {
    const results_area = this.widget.node.querySelector(
      '#results-panel-group'
    ) as HTMLElement;
    if (results_area) {
      this.loading_statement(results_area);
      let data: any = null;
      try {
        data = await requestAPI<any>(
          'baAutograde?assignment_code=' + assignent_code
        );
      } catch (reason) {
        console.error('do_utograde caught error:', reason);
        const msg: string = 'Error on GET baAutograde.\n' + reason;
        this.show_error('<p>' + msg + '</p>');
      }

      if (data) {
        this.handle_response_data(results_area, data);
      }
    }
  }

  private handle_response_data(results_area: HTMLElement, data: any): void {
    if (results_area) {
      results_area.innerHTML = data.value;
    }
  }

  private clear_area(element: HTMLElement): void {
    if (element!.children.length > 0) {
      element!.innerHTML = '';
    }
  }

  private loading_statement(element: HTMLElement): void {
    if (element) {
      if (element.children.length > 0) {
        element.innerHTML = '<p class="ba_loader">Loading......</p>';
      }
    }
  }

  private make_button(
    assignment_code: string,
    text: string,
    disabled: boolean,
    do_Action: (params?: any) => void,
    actionParams?: any
  ): HTMLButtonElement {
    const button: HTMLButtonElement = document.createElement('button');
    button.classList.add('btn');
    button.setAttribute(
      'aria-label',
      text + ' for Assignment ' + assignment_code
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
    button.textContent = text;
    return button;
  }

  private make_row(
    table_body: HTMLTableSectionElement,
    assignment_code: string,
    data: IAssignmentDetail
  ): void {
    const row = document.createElement('tr');
    table_body.append(row);
    row.setAttribute('aria-label', assignment_code);
    const assignment_name_cell = document.createElement('td');
    const values_cell = document.createElement('td');
    const buttons_cell = document.createElement('td');
    row.append(assignment_name_cell, values_cell, buttons_cell);

    assignment_name_cell.innerText = assignment_code;

    values_cell.style.padding = '0 1em';
    values_cell.innerText =
      'Exchange:' + data.exchange + ', Locally:' + data.locally;
    values_cell.setAttribute(
      'aria-label',
      'Counts for Assignment: ' +
        assignment_code +
        ', Exchange count:' +
        data.exchange +
        ', Local count:' +
        data.locally
    );
    let disable_button = false;
    if (data.exchange === data.locally) {
      disable_button = true;
    }
    const collectButton: HTMLButtonElement = this.make_button(
      assignment_code,
      'Collect',
      disable_button,
      this.do_collect.bind(this),
      assignment_code
    );
    const autogradeButton: HTMLButtonElement = this.make_button(
      assignment_code,
      'Bulk Autograde',
      false,
      this.do_autograde.bind(this),
      assignment_code
    );
    buttons_cell.append(collectButton, autogradeButton);
    buttons_cell.setAttribute(
      'aria-label',
      'Action buttons for Assignment: ' + assignment_code
    );
  }

  private make_table_heading(table: HTMLTableElement): void {
    const thead = table.createTHead();
    const thead_row = thead.insertRow();
    const head_items = ['Assignment Name', 'Submission Counts', 'Actions'];
    head_items.forEach(headerText => {
      const header_cell = document.createElement('th'); // 'cos the API route is depreciated
      header_cell.textContent = headerText;
      thead_row.appendChild(header_cell);
    });
  }

  private load_list_success(data: IAssignmentRecord): void {
    this.clear_list();
    // build the list of items lin the list
    const table = this.assignment_table_element;
    if (table) {
      this.make_table_heading(table);
      const table_body = table.createTBody();
      for (const assignment_code in data) {
        this.make_row(table_body, assignment_code, data[assignment_code]);
      }
      // Now toggle the "loading" for the table
      const message_element = document.getElementById(
        'assignment_list_default'
      );
      if (message_element) {
        message_element.innerHTML =
          '<p>This table lists all assignments for the current course<br /\n' +
          '<p>For each assignment, it shows the number of students who have submitted work to the exchange' +
          ' and the number of submissions held locally.</p>\n' +
          '<p>Select the action you want from the table below:</p>\n';
      }
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
      // Notification.emit(message, 'error', { autoClose: false });
    }
  }
}
