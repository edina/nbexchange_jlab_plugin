import { JupyterFrontEnd } from '@jupyterlab/application';

import { requestAPI } from '../handler';
import { HistoryList } from './history';
import { HistoryWidget } from './index';

jest.mock('../handler', () => ({ requestAPI: jest.fn() }));

const coursesResponse = {
  success: true,
  items: [
    {
      id: 35,
      code: 'my_course_code',
      title: 'My Course Title',
      roles: ['Instructor'],
      is_instructor: true,
      is_current: true,
      assignment_count: 1
    }
  ]
};

const assignmentsResponse = {
  success: true,
  roles: ['Instructor'],
  is_instructor: true,
  items: [
    {
      id: 80,
      code: 'test 123',
      action_summary: { submitted: 2 },
      first_action_at: '2022-01-17T15:53:11+00:00',
      last_action_at: '2022-01-17T15:54:11+00:00'
    }
  ]
};

const action = {
  id: 101,
  action: 'AssignmentActions.submitted',
  timestamp: '2022-01-17T15:53:11+00:00',
  path: '/courses/35/assignments/80/submit',
  user: '1-kiz'
};

const flush = async (): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, 0));
};

const expand = async (element: HTMLDetailsElement): Promise<void> => {
  element.open = true;
  element.dispatchEvent(new Event('toggle'));
  await flush();
};

describe('HistoryWidget lazy loading', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    jest.resetAllMocks();
    jest.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('initializes and requests only course metadata', async () => {
    (requestAPI as jest.Mock).mockResolvedValue(coursesResponse);
    const widget = new HistoryWidget({} as JupyterFrontEnd);
    await flush();

    expect(widget.node.querySelector('#history_h2')).not.toBeNull();
    expect(widget.node.querySelector('#actions-panel-group')).not.toBeNull();
    expect(requestAPI).toHaveBeenCalledTimes(1);
    expect(requestAPI).toHaveBeenCalledWith('history/courses');
    expect(widget.node.querySelectorAll('.course_group')).toHaveLength(1);
  });

  it('handles network and API errors', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    (requestAPI as jest.Mock).mockRejectedValueOnce(new Error('Network Error'));
    const widget = new HistoryWidget({} as JupyterFrontEnd);
    await flush();
    expect(widget.node.querySelector('.alert-danger')?.innerHTML).toContain(
      'Error on GET /history/courses'
    );

    (requestAPI as jest.Mock).mockResolvedValueOnce({
      success: false,
      value: 'Some error occurred'
    });
    const secondWidget = new HistoryWidget({} as JupyterFrontEnd);
    await flush();
    expect(
      secondWidget.node.querySelector('.alert-danger')?.innerHTML
    ).toContain('Some error occurred');
    errorSpy.mockRestore();
  });

  it('shows an empty state', async () => {
    (requestAPI as jest.Mock).mockResolvedValue({ success: true, items: [] });
    const widget = new HistoryWidget({} as JupyterFrontEnd);
    await flush();
    expect(widget.node.querySelector('.alert-info')?.innerHTML).toContain(
      'There is no history to show you'
    );
  });

  it('puts the current course first', async () => {
    (requestAPI as jest.Mock).mockResolvedValue({
      success: true,
      items: [
        { ...coursesResponse.items[0], id: 36, code: 'old', is_current: false },
        {
          ...coursesResponse.items[0],
          id: 37,
          code: 'current',
          is_current: true
        }
      ]
    });
    const widget = new HistoryWidget({} as JupyterFrontEnd);
    await flush();
    const courses =
      widget.node.querySelectorAll<HTMLDetailsElement>('.course_group');
    expect(courses).toHaveLength(2);
    expect(courses[0].classList).toContain('current_course');
    expect(courses[0].querySelector('summary')?.textContent).toContain(
      'current'
    );
  });

  it('loads assignments and actions only when their rows are expanded', async () => {
    (requestAPI as jest.Mock)
      .mockResolvedValueOnce(coursesResponse)
      .mockResolvedValueOnce(assignmentsResponse)
      .mockResolvedValueOnce({
        success: true,
        items: [action],
        next_cursor: null,
        snapshot: '2022-01-18T00:00:00+00:00'
      });
    const widget = new HistoryWidget({} as JupyterFrontEnd);
    await flush();

    const course =
      widget.node.querySelector<HTMLDetailsElement>('.course_group')!;
    expect(requestAPI).toHaveBeenCalledTimes(1);
    await expand(course);
    expect(requestAPI).toHaveBeenNthCalledWith(
      2,
      'history/courses/35/assignments'
    );

    const actionGroup = widget.node.querySelector<HTMLDetailsElement>(
      '.action-group > details'
    )!;
    expect(actionGroup).not.toBeNull();
    expect(requestAPI).toHaveBeenCalledTimes(2);
    await expand(actionGroup);
    expect((requestAPI as jest.Mock).mock.calls[2][0]).toContain(
      'history/assignments/80/actions?action=submitted&limit=100'
    );
    expect(actionGroup.querySelectorAll('.action-row')).toHaveLength(1);
    expect(actionGroup.querySelectorAll('.action-row button')).toHaveLength(2);
  });

  it('loads subsequent action pages with the returned cursor and snapshot', async () => {
    (requestAPI as jest.Mock)
      .mockResolvedValueOnce(coursesResponse)
      .mockResolvedValueOnce(assignmentsResponse)
      .mockResolvedValueOnce({
        success: true,
        items: [action],
        next_cursor: 'next-page',
        snapshot: '2022-01-18T00:00:00+00:00'
      })
      .mockResolvedValueOnce({
        success: true,
        items: [{ ...action, id: 100 }],
        next_cursor: null,
        snapshot: '2022-01-18T00:00:00+00:00'
      });
    const widget = new HistoryWidget({} as JupyterFrontEnd);
    await flush();
    await expand(
      widget.node.querySelector<HTMLDetailsElement>('.course_group')!
    );
    const actionGroup = widget.node.querySelector<HTMLDetailsElement>(
      '.action-group > details'
    )!;
    await expand(actionGroup);
    const loadMore =
      actionGroup.querySelector<HTMLButtonElement>('.history-load-more')!;
    loadMore.click();
    await flush();

    const request = (requestAPI as jest.Mock).mock.calls[3][0];
    expect(request).toContain('cursor=next-page');
    expect(request).toContain('snapshot=2022-01-18T00%3A00%3A00%2B00%3A00');
    expect(actionGroup.querySelectorAll('.action-row')).toHaveLength(2);
    expect(loadMore.style.display).toBe('none');
  });

  it('does not show collect or download buttons to students', async () => {
    (requestAPI as jest.Mock)
      .mockResolvedValueOnce({
        success: true,
        items: [
          {
            ...coursesResponse.items[0],
            roles: ['Student'],
            is_instructor: false
          }
        ]
      })
      .mockResolvedValueOnce({
        ...assignmentsResponse,
        roles: ['Student'],
        is_instructor: false
      })
      .mockResolvedValueOnce({
        success: true,
        items: [action],
        next_cursor: null,
        snapshot: '2022-01-18T00:00:00+00:00'
      });
    const widget = new HistoryWidget({} as JupyterFrontEnd);
    await flush();
    await expand(
      widget.node.querySelector<HTMLDetailsElement>('.course_group')!
    );
    const actionGroup = widget.node.querySelector<HTMLDetailsElement>(
      '.action-group > details'
    )!;
    await expand(actionGroup);
    expect(actionGroup.querySelectorAll('.action-row button')).toHaveLength(0);
  });

  it('formats dates and manages alerts', async () => {
    (requestAPI as jest.Mock).mockResolvedValue(coursesResponse);
    const widget = new HistoryWidget({} as JupyterFrontEnd);
    await flush();
    const history = new HistoryList(widget, 'actions-panel-group');
    expect(history.formatDate(new Date(2026, 7, 21))).toBe('2026-08-21');

    history.show_info('<p>Info</p>');
    history.show_error('<p>Error</p>');
    expect(widget.node.querySelector('.alert-info')?.innerHTML).toBe(
      '<p>Info</p>'
    );
    expect(widget.node.querySelector('.alert-danger')?.innerHTML).toBe(
      '<p>Error</p>'
    );
    history.clear_list();
    expect(widget.node.querySelector('.alert-info')?.innerHTML).toBe('');
    expect(widget.node.querySelector('.alert-danger')?.innerHTML).toBe('');
    expect(widget.node.querySelector('#actions-panel-group')?.innerHTML).toBe(
      ''
    );
  });
});
