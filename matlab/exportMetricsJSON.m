function dataset = exportMetricsJSON(inputData, outputFile, options)
%EXPORTMETRICSJSON Export metric structs to Metrics Viewer JSON (schema v1).
%   With no input, select MAT files and a JSON destination. All loaded subjects
%   are included without another selection. Progress=false disables waitbars.
%   Scalar NaN metrics mark unavailable short epochs and become empty series.
%   Epochs containing only unavailable metrics are omitted; subjects without
%   remaining epochs are omitted. If none remain, no output file is written.
arguments
    inputData = []
    outputFile {mustBeTextScalar} = ""
    options.Interactive (1,1) logical = strlength(string(outputFile)) == 0
    options.Progress (1,1) logical = true
end

dataset = [];

useWaitbar = options.Progress && usejava('desktop');
hWait = [];
if useWaitbar
    hWait = waitbar(0, 'Preparing export...', 'Name', 'Metrics Viewer');
    drawnow;
end
cleanupWaitbar = onCleanup(@() closeWaitbar(hWait));

if isempty(inputData)
    if ~options.Interactive
        error('MetricsViewer:EmptyInput', 'No metric structs supplied.');
    end

    [names, folder] = uigetfile('*.mat', ...
        'Select MAT files containing metric structs', 'MultiSelect', 'on');
    if isequal(names, 0)
        return;
    end

    names = string(names);
    candidates = cell(0,1);

    if useWaitbar
        waitbar(0, hWait, 'Scanning MAT files...');
        drawnow;
    end

    for fileIndex = 1:numel(names)
        if useWaitbar
            waitbar(fileIndex / numel(names), hWait, ...
                sprintf('Scanning MAT files... (%d/%d)', fileIndex, numel(names)));
        end

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

records = cell(1, numel(candidates));
subjects = strings(1, numel(candidates));

if useWaitbar
    waitbar(0, hWait, 'Converting structs...');
    drawnow;
end

for index = 1:numel(candidates)
    if useWaitbar
        waitbar(index / numel(candidates), hWait, ...
            sprintf('Converting structs... (%d/%d)', index, numel(candidates)));
    end

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
    if isequal(name, 0)
        return;
    end
    outputFile = fullfile(folder, name);
end

if strlength(string(outputFile)) > 0
    destination = string(outputFile);
    [folder,~,extension] = fileparts(destination);

    if extension == ""
        destination = destination + ".json";
    elseif ~strcmpi(extension, '.json')
        error('MetricsViewer:Extension', 'Output file must have a .json extension.');
    end

    if folder == ""
        folder = string(pwd);
    end
    if ~isfolder(folder)
        error('MetricsViewer:OutputFolder', 'Output folder does not exist.');
    end

    if useWaitbar
        waitbar(0, hWait, 'Writing JSON...');
        drawnow;
    end

    json = jsonencode(result);
    temporary = string(tempname(folder)) + ".json";
    cleanupTemporary = onCleanup(@() removeTemporary(temporary));

    [fid, message] = fopen(temporary, 'w', 'n', 'UTF-8');
    if fid == -1
        error('MetricsViewer:WriteFailed', '%s', message);
    end

    fileCleanup = onCleanup(@() closeFile(fid));
    bytes = unicode2native(json, 'UTF-8');
    written = fwrite(fid, bytes, 'uint8');
    closeStatus = fclose(fid);
    clear fileCleanup

    if written ~= numel(bytes) || closeStatus ~= 0
        error('MetricsViewer:WriteFailed', 'Could not write the complete JSON file.');
    end

    [ok, message] = movefile(temporary, destination, 'f');
    if ~ok
        error('MetricsViewer:WriteFailed', '%s', message);
    end
    clear cleanupTemporary

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

epochs = cell(1, numel(ids));
keepEpoch = true(1, numel(ids));
for epochIndex = 1:numel(ids)
    metrics = struct();
    missingPlaceholder = false;
    hasSamples = false;

    for metricIndex = 1:numel(names)
        name = names{metricIndex};
        valuesByEpoch = s.metrics.(name);
        timesByEpoch = s.metrics_time.(name);

        if ~iscell(valuesByEpoch) || ~iscell(timesByEpoch) || ...
                numel(valuesByEpoch) ~= numel(ids) || numel(timesByEpoch) ~= numel(ids)
            error('MetricsViewer:Dimensions', '%s/%s: one cell per epoch is required.', subject, name);
        end

        values = valuesByEpoch{epochIndex};
        times = timesByEpoch{epochIndex};

        if isempty(values) && isempty(times)
            metrics.(name) = struct('time', [], 'values', []);
            continue;
        elseif isempty(values) || isempty(times)
            error('MetricsViewer:Dimensions', ...
                '%s/%s/%s: time and values must both be empty or both nonempty.', ...
                subject, ids(epochIndex), name);
        end

        if ~isnumeric(values) || ~isreal(values) || ~isvector(values) || ...
                ~isnumeric(times) || ~isreal(times) || ~isvector(times) || ...
                numel(values) ~= numel(times)
            error('MetricsViewer:Dimensions', ...
                '%s/%s/%s: matching real numeric vectors required.', subject, ids(epochIndex), name);
        end

        times = double(times(:).');
        values = double(values(:).');

        if isscalar(values) && isnan(values) && isscalar(times) && ...
                (isnan(times) || (isfinite(times) && times >= 0))
            metrics.(name) = struct('time', [], 'values', []);
            missingPlaceholder = true;
            continue;
        end

        if any(~isfinite(times)) || any(times < 0) || any(diff(times) <= 0)
            error('MetricsViewer:Times', ...
                '%s/%s/%s: times must be finite, nonnegative and strictly increasing.', ...
                subject, ids(epochIndex), name);
        end

        hasSamples = true;
        values(~isfinite(values)) = NaN;
        % Preserve JSON array shape also for a valid single-sample metric.
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
    if isfield(s, name)
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
    if fid > 0
        fclose(fid);
    end
catch
end
end

function removeTemporary(path)
if isfile(path)
    delete(path);
end
end

function closeWaitbar(hWait)
if ~isempty(hWait) && isgraphics(hWait)
    delete(hWait);
end
end