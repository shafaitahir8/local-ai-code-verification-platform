import { Card, CardDescription, CardHeader, CardTitle, StatusBadge } from '@verify/ui';

import type { InspectionResult } from '../dashboard/types.js';
import { FileIcon } from './icons.js';

export function ChangePanel({ inspection }: { readonly inspection: InspectionResult }) {
  return (
    <Card aria-labelledby="changes-title">
      <CardHeader>
        <div>
          <p className="eyebrow">Working tree</p>
          <CardTitle id="changes-title">Current changes</CardTitle>
          <CardDescription>
            {inspection.filesChanged} changed {inspection.filesChanged === 1 ? 'file' : 'files'}
          </CardDescription>
        </div>
        <div
          className="diff-stat"
          aria-label={`${inspection.additions} additions and ${inspection.deletions} deletions`}
        >
          <span className="diff-stat__add">+{inspection.additions}</span>
          <span className="diff-stat__delete">−{inspection.deletions}</span>
        </div>
      </CardHeader>
      {inspection.files.length === 0 ? (
        <div className="compact-empty">
          <StatusBadge status="passed" label="Working tree is clean" />
        </div>
      ) : (
        <div className="table-scroll" tabIndex={0} aria-label="Scrollable changed files">
          <table className="data-table">
            <caption className="verify-sr-only">Changed files in the selected repository</caption>
            <thead>
              <tr>
                <th scope="col">File</th>
                <th scope="col">State</th>
                <th scope="col">Lines</th>
              </tr>
            </thead>
            <tbody>
              {inspection.files.map((file) => (
                <tr key={`${file.path}-${String(file.staged)}-${String(file.unstaged)}`}>
                  <th scope="row">
                    <span className="file-name">
                      <FileIcon />
                      {file.path}
                    </span>
                  </th>
                  <td>
                    <span className="file-state">
                      {file.status}
                      <span className="muted-text">
                        {file.staged && file.unstaged
                          ? 'staged + unstaged'
                          : file.staged
                            ? 'staged'
                            : 'unstaged'}
                      </span>
                    </span>
                  </td>
                  <td>
                    <span className="line-stat">
                      {file.statistics.known ? (
                        <>
                          <span className="diff-stat__add">+{file.statistics.additions ?? 0}</span>{' '}
                          <span className="diff-stat__delete">
                            −{file.statistics.deletions ?? 0}
                          </span>
                        </>
                      ) : (
                        <span className="muted-text">
                          {file.statistics.binary ? 'binary' : 'not available'}
                        </span>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
