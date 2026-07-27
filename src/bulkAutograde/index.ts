import { JupyterFrontEnd } from '@jupyterlab/application';

import { Widget } from '@lumino/widgets';

import { PageConfig } from '@jupyterlab/coreutils';

import { BaAssignmentsList, AssignmentsList } from './bulkAutograde';

export class BulkAutogradeWidget extends Widget {
  app: JupyterFrontEnd;

  constructor(app: JupyterFrontEnd) {
    super();
    this.app = app;

    this.node.innerHTML = [
      '<h2 id="bulkautograder_h2">NbExchange Bulk Autograder</h2>',
      '<div id="assignments-toolbar" class="row list_toolbar">',
      '  <div class="col-sm-8 no-padding"> <!-- -->',
      '    <div>',
      '      <div id="assignment_list_default"><p>Querying to get assignment details</p></div>',
      '      <table id="assignment-table" border="0" aria-label="Table of assignments and their details">',
      '      </table>',
      '    </div>',
      '  </div> <!-- -->',
      '  <div class="col-sm-4 no-padding tree-buttons">',
      '    <span id="history_buttons" class="pull-right toolbar_buttons">',
      '    <button id="refresh_assignment_list" class="btn btn-default btn-xs" ',
      '            aria-label="Refresh table of assignments"><i class="fa fa-refresh"></i></button>',
      '    </span>',
      '  </div>',
      '</div>',
      '<div id="baautograde-alert-danger" role="alert" class="alert alert-danger">',
      '</div>',
      '<div id="baautograde-alert-info" role="alert" class="alert alert-info">',
      '</div>',
      '<div><span class="ba_loader"></span></div>',
      '<div class="panel-group" id="results-panel-group">',
      '<div>'
    ].join('\n');
    this.node.style.overflowY = 'auto';

    const base_url = PageConfig.getBaseUrl();
    const options = new Map();
    options.set('base_url', base_url);
    const assignments = new BaAssignmentsList(this, 'results-panel-group');

    new AssignmentsList(
      this,
      'assignment-table', // id for element to put assignments into
      'assignment_list_default', // the "loading..." message
      'refresh_assignment_list', // refresh the page
      assignments, // big list of assignments for the course
      options
    );

    // this.checkNbGraderVersion();
  }
}
