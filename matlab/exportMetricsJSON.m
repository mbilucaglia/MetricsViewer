function dataset = exportMetricsJSON(inputData, outputFile, options)
%EXPORTMETRICSJSON Export metric structs to Metrics Viewer JSON (schema v1).
%   exportMetricsJSON opens MAT-file and destination dialogs (all loaded subjects).
%   exportMetricsJSON(S) exports all subjects from S and asks where to save.
%   D = exportMetricsJSON(S, "metrics.json") exports without dialogs.
%   S can be a scalar struct, struct array, or cell array of structs.
%   D = exportMetricsJSON(S, "", Interactive=false) returns data without saving.
%   exportMetricsJSON(S, "out.json", Interactive=true) uses all supplied subjects.
%
%   Required fields: subject, epoch_id, metrics, metrics_time. Each metric
%   contains one cell per epoch, with matching real numeric time/value vectors.
%   Times are seconds relative to epoch onset; Fs is intentionally unused.
%   A scalar NaN metric is unavailable: it becomes an empty series, and epochs
%   containing only unavailable metrics are omitted. Subjects with no remaining
%   epochs are omitted; if none remain, no file is written. Other NaN/Inf values
%   become JSON null; nonfinite times are rejected. Empty metric
%   vectors are retained. No normalization, aggregation or resampling occurs.
%   One recording per subject and unique epoch labels are required. Cancelling
%   any dialog returns [] and does not create or overwrite a file.
%   Requires MATLAB R2021a or newer. Uses only base MATLAB.
arguments
    inputData = []
    outputFile {mustBeTextScalar} = ""
    options.Interactive (1,1) logical = strlength(string(outputFile)) == 0
end
dataset = [];
if isempty(inputData)
    if ~options.Interactive
        error('MetricsViewer:EmptyInput', 'No metric structs supplied.');
    end
    [names, folder] = uigetfile('*.mat', ...
        'Select MAT files containing metric structs', 'MultiSelect', 'on');
    if isequal(names, 0), return; end
    names = string(names);
    candidates = cell(0,1);
    for fileIndex = 1:numel(names)
        filePath = fullfile(folder, names(fileIndex));
        info = whos('-file', filePath);
        for variableIndex = 1:numel(info)
            if ~ismember(string(info(variableIndex).class), ["struct", "cell"])
                continue;
            end
            variableName = info(variableIndex).name;
            loaded = load(filePath, variableName);
            found = collectStructs(loaded.(variableName));
            candidates = [candidates; found]; %#ok<AGROW>
        end
    end
else
    candidates = collectStructs(inputData);
end
if isempty(candidates)
    error('MetricsViewer:EmptyInput', ...
        'No structs with subject, epoch_id, metrics and metrics_time found.');
end
records = cell(1,numel(candidates));
subjects = strings(1,numel(candidates));
for index = 1:numel(candidates)
    records{index} = convertStruct(candidates{index});
    subjects(index) = records{index}.subject;
end
if numel(unique(subjects)) ~= numel(subjects)
    error('MetricsViewer:DuplicateSubject', ...
        'Duplicate subjects selected. Choose one recording per subject.');
end
keep = cellfun(@(r) ~isempty(r.epochs), records);
if any(~keep)
    fprintf('Metrics Viewer: omitted %d subjects without usable epochs.\n', sum(~keep));
end
records = records(keep);
if isempty(records)
    error('MetricsViewer:NoUsableEpochs', 'No usable epochs remain: all metrics are unavailable.');
end
result = struct('schema_version', 1, 'time_unit', 's', 'recordings', {records});
if options.Interactive && strlength(string(outputFile)) == 0
    [name, folder] = uiputfile('*.json', 'Save Metrics Viewer dataset', 'metrics.json');
    if isequal(name,0), return; end
    outputFile = fullfile(folder, name);
end
if strlength(string(outputFile)) > 0
    destination = string(outputFile);
    [folder,~,extension] = fileparts(destination);
    if extension == "", destination = destination + ".json";
    elseif ~strcmpi(extension,'.json')
        error('MetricsViewer:Extension', 'Output file must have a .json extension.');
    end
    if folder == "", folder = string(pwd); end
    if ~isfolder(folder), error('MetricsViewer:OutputFolder', 'Output folder does not exist.'); end
    json = encodeDataset(result);
    temporary = string(tempname(folder)) + ".json";
    cleanup = onCleanup(@() removeTemporary(temporary));
    [fid,message] = fopen(temporary, 'w', 'n', 'UTF-8');
    if fid == -1, error('MetricsViewer:WriteFailed', '%s', message); end
    fileCleanup = onCleanup(@() closeFile(fid));
    bytes = unicode2native(json, 'UTF-8');
    written = fwrite(fid, bytes, 'uint8');
    closeStatus = fclose(fid);
    clear fileCleanup
    if written ~= numel(bytes) || closeStatus ~= 0
        error('MetricsViewer:WriteFailed', 'Could not write the complete JSON file.');
    end
    [ok,message] = movefile(temporary, destination, 'f');
    if ~ok, error('MetricsViewer:WriteFailed', '%s', message); end
    clear cleanup
    fprintf('Metrics Viewer: exported %d subjects to %s\n', numel(records), destination);
end
dataset = result;
end

function items = collectStructs(value)
items = cell(0,1);
if iscell(value)
    for index = 1:numel(value)
        items = [items; collectStructs(value{index})]; %#ok<AGROW>
    end
elseif isstruct(value) && all(isfield(value, {'subject','epoch_id','metrics','metrics_time'}))
    items = reshape(num2cell(value), [], 1);
end
end

function record = convertStruct(s)
subject = textScalar(s.subject, 'subject');
if ~(isstring(s.epoch_id) || iscellstr(s.epoch_id) || ischar(s.epoch_id))
    error('MetricsViewer:Epochs', '%s: epoch_id must contain text labels.', subject);
end
ids = string(s.epoch_id);
if isempty(ids) || ~isvector(ids) || any(ismissing(ids) | strlength(strtrim(ids)) == 0) || numel(unique(ids)) ~= numel(ids)
    error('MetricsViewer:Epochs', '%s: epoch labels must be nonempty and unique.', subject);
end
if ~isstruct(s.metrics) || ~isscalar(s.metrics) || ~isstruct(s.metrics_time) || ~isscalar(s.metrics_time)
    error('MetricsViewer:Metrics', '%s: metrics and metrics_time must be scalar structs.', subject);
end
names = fieldnames(s.metrics);
if isempty(names) || ~isequal(sort(names), sort(fieldnames(s.metrics_time)))
    error('MetricsViewer:Metrics', '%s: metrics and metrics_time must have the same nonempty fields.', subject);
end
epochs = cell(1,numel(ids));
keepEpoch = true(1,numel(ids));
for epochIndex = 1:numel(ids)
    metrics = struct();
    missingPlaceholder = false;
    hasSamples = false;
    for metricIndex = 1:numel(names)
        name = names{metricIndex};
        valuesByEpoch = s.metrics.(name);
        timesByEpoch = s.metrics_time.(name);
        if ~iscell(valuesByEpoch) || ~iscell(timesByEpoch) || numel(valuesByEpoch) ~= numel(ids) || numel(timesByEpoch) ~= numel(ids)
            error('MetricsViewer:Dimensions', '%s/%s: one cell per epoch is required.', subject, name);
        end
        values = valuesByEpoch{epochIndex};
        times = timesByEpoch{epochIndex};
        if ~isnumeric(values) || ~isreal(values) || ~(isempty(values) || isvector(values)) || ...
                ~isnumeric(times) || ~isreal(times) || ~(isempty(times) || isvector(times)) || numel(values) ~= numel(times)
            error('MetricsViewer:Dimensions', '%s/%s/%s: matching real numeric vectors required.', subject, ids(epochIndex), name);
        end
        times = double(times(:).');
        values = double(values(:).');
        % A scalar NaN marks a metric that could not be computed (short epoch).
        if isscalar(values) && isnan(values) && isscalar(times) && ...
                (isnan(times) || (isfinite(times) && times >= 0))
            metrics.(name) = struct('time', [], 'values', []);
            missingPlaceholder = true;
            continue;
        end
        if any(~isfinite(times)) || any(times < 0) || any(diff(times) <= 0)
            error('MetricsViewer:Times', '%s/%s/%s: times must be finite, nonnegative and strictly increasing.', subject, ids(epochIndex), name);
        end
        hasSamples = hasSamples || ~isempty(values);
        values(~isfinite(values)) = NaN;
        % Numeric vectors serialize much faster than one cell per sample.
        % Only scalars need wrapping to preserve the JSON array shape.
        if isscalar(times), times = {times}; end
        if isscalar(values), values = {values}; end
        metrics.(name) = struct('time', {times}, 'values', {values});
    end
    keepEpoch(epochIndex) = ~(missingPlaceholder && ~hasSamples);
    epochs{epochIndex} = struct('id', ids(epochIndex), 'metrics', metrics);
end
if any(~keepEpoch)
    fprintf('Metrics Viewer: %s: omitted %d unavailable epochs.\n', subject, sum(~keepEpoch));
end
epochs = epochs(keepEpoch);
metadata = struct();
for name = ["date", "origin"]
    if isfield(s,name)
        metadata.(name) = textScalar(s.(name), name);
    end
end
record = struct('id', subject, 'subject', subject, 'metadata', metadata, 'epochs', {epochs});
end

function result = textScalar(value, name)
if ~(ischar(value) && isrow(value) || isstring(value) && isscalar(value))
    error('MetricsViewer:Text', '%s must be a text scalar.', name);
end
result = string(value);
if ismissing(result) || strlength(strtrim(result)) == 0
    error('MetricsViewer:Text', '%s must not be empty.', name);
end
end

function closeFile(fid)
try
    if ~isempty(fopen(fid)), fclose(fid); end
catch
    % File was already closed after a successful write.
end
end

function removeTemporary(path)
if isfile(path), delete(path); end
end

function json = encodeDataset(dataset)
% Encode numeric arrays in bulk; jsonencode still handles all text escaping.
records = dataset.recordings;
recordJSON = cell(size(records));
for recordIndex = 1:numel(records)
    record = records{recordIndex};
    epochs = record.epochs;
    epochJSON = cell(size(epochs));
    names = fieldnames(epochs{1}.metrics);
    encodedNames = cellfun(@jsonencode, names, 'UniformOutput', false);
    for epochIndex = 1:numel(epochs)
        epoch = epochs{epochIndex};
        metricJSON = cell(size(names));
        for metricIndex = 1:numel(names)
            series = epoch.metrics.(names{metricIndex});
            metricJSON{metricIndex} = [encodedNames{metricIndex}, ...
                ':{"time":', encodeVector(series.time), ...
                ',"values":', encodeVector(series.values), '}'];
        end
        epochJSON{epochIndex} = ['      {"id":', jsonencode(epoch.id), ...
            ',"metrics":{', strjoin(metricJSON, ','), '}}'];
    end
    recordJSON{recordIndex} = ['    {"id":', jsonencode(record.id), ...
        ',"subject":', jsonencode(record.subject), ...
        ',"metadata":', jsonencode(record.metadata), ...
        ',"epochs":[', newline, strjoin(epochJSON, [',', newline]), ...
        newline, '    ]}'];
end
json = ['{"schema_version":1,"time_unit":"s","recordings":[', ...
    newline, strjoin(recordJSON, [',', newline]), newline, ']}'];
end

function json = encodeVector(values)
if iscell(values), values = cell2mat(values); end
if isempty(values)
    json = '[]';
    return;
end
% 17 significant digits preserve the exact IEEE double on round trip.
numbers = sprintf('%.17g,', values);
numbers(end) = [];
json = ['[', strrep(numbers, 'NaN', 'null'), ']'];
end
